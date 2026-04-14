/**
 * TaskConsoleView — xterm.js terminal showing raw Claude Code PTY output.
 *
 * On mount: replay the in-memory buffer, fall back to the on-disk buffer
 * (post-restart), then subscribe to live PTY data. The in-rAF ordering
 * guarantees no gap between replay and live subscription (JS is single-threaded).
 * WebGL renderer is required — the DOM renderer drops cells under Ink's
 * rapid redraws (plan-mode prompt).
 */

import { useRef, useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowDown, Play } from 'lucide-react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { WebglAddon } from '@xterm/addon-webgl';
import '@xterm/xterm/css/xterm.css';
import { useTasks } from '../../../context/TaskContext';
import { getTaskTerminalBuffer } from './taskTerminalBuffer';
import type { Task, TaskLogEntry } from './types';

interface TaskConsoleViewProps {
  task: Task;
  liveTask: {
    taskId: string;
    runId: string;
    logEntries: TaskLogEntry[];
  } | null;
}

const THEME = {
  background: '#0a0a0f',
  foreground: '#e4e4ef',
  cursor: '#e4e4ef',
  cursorAccent: '#0a0a0f',
  selectionBackground: '#6366f140',
  black: '#1a1a25',
  red: '#ef4444',
  green: '#22c55e',
  yellow: '#f59e0b',
  blue: '#3b82f6',
  magenta: '#a855f7',
  cyan: '#06b6d4',
  white: '#e4e4ef',
  brightBlack: '#55556a',
  brightRed: '#f87171',
  brightGreen: '#4ade80',
  brightYellow: '#fbbf24',
  brightBlue: '#60a5fa',
  brightMagenta: '#c084fc',
  brightCyan: '#22d3ee',
  brightWhite: '#ffffff',
};

export default function TaskConsoleView({ task, liveTask }: TaskConsoleViewProps) {
  const { t } = useTranslation();
  const { resumeTask } = useTasks();
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const [isResuming, setIsResuming] = useState(false);
  const hasPtyDataRef = useRef(false);
  const writtenCountRef = useRef(0);

  const isLive = liveTask?.taskId === task.id;
  const runId = isLive ? liveTask!.runId : task.run_id;
  const taskIsActive = task.status === 'running' || task.status === 'clarifying' || task.status === 'planning';
  const taskIsTerminal = task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled';

  // Use a ref for runId so sendResizeIfChanged is stable (no runId dep)
  const runIdRef = useRef(runId);
  runIdRef.current = runId;

  const lastColsRef = useRef(0);
  const lastRowsRef = useRef(0);

  const safeFit = useCallback(() => {
    const el = containerRef.current;
    if (el && el.clientWidth > 0 && el.clientHeight > 0) {
      try {
        fitRef.current?.fit();
        termRef.current?.refresh(0, (termRef.current?.rows ?? 1) - 1);
      } catch { /* detached */ }
    }
  }, []);

  const sendResizeIfChanged = useCallback(() => {
    const terminal = termRef.current;
    const rid = runIdRef.current;
    if (!terminal || !rid) return;
    const { cols, rows } = terminal;
    if (cols === lastColsRef.current && rows === lastRowsRef.current) return;
    lastColsRef.current = cols;
    lastRowsRef.current = rows;
    window.cerebro.taskTerminal.resize(rid, cols, rows);
  }, []);

  // ── Terminal lifecycle + PTY subscription (Turbo pattern) ────

  useEffect(() => {
    if (!containerRef.current) return;
    let disposed = false;
    let unsubPty: (() => void) | null = null;

    const terminal = new Terminal({
      convertEol: true,
      scrollback: 10_000,
      fontSize: 13,
      fontFamily: "'Geist Mono', 'SF Mono', 'Menlo', monospace",
      lineHeight: 1.4,
      cursorBlink: true,
      cursorStyle: 'bar',
      allowProposedApi: true,
      theme: THEME,
    });

    // Forward user keystrokes to the PTY's stdin (accept trust dialog, type, etc.)
    terminal.onData((data) => {
      const rid = runIdRef.current;
      if (rid) {
        window.cerebro.taskTerminal.sendInput(rid, data);
      }
    });

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();

    terminal.loadAddon(fitAddon);
    terminal.loadAddon(webLinksAddon);
    terminal.open(containerRef.current);

    // WebGL renderer — fixes cell-clearing artifacts under rapid TUI redraws
    // (Ink's plan-mode prompt stacks text on the default DOM renderer).
    let webglAddon: WebglAddon | null = null;
    try {
      const addon = new WebglAddon();
      addon.onContextLoss(() => {
        addon.dispose();
        webglAddon = null;
        terminal.refresh(0, terminal.rows - 1);
      });
      terminal.loadAddon(addon);
      webglAddon = addon;
    } catch (err) {
      console.warn('[TaskConsoleView] WebGL renderer unavailable, falling back to DOM', err);
    }

    termRef.current = terminal;
    fitRef.current = fitAddon;
    writtenCountRef.current = 0;
    hasPtyDataRef.current = false;

    terminal.onScroll(() => {
      if (disposed) return;
      const buf = terminal.buffer.active;
      setShowScrollBtn(buf.viewportY < buf.baseY);
    });

    // Subscribe to PTY data inside rAF — after buffer replay, before any
    // new data can arrive (JS is single-threaded within the rAF callback).
    requestAnimationFrame(() => {
      if (disposed) return;
      safeFit();

      const rid = runIdRef.current;
      if (rid) {
        // 1. Replay in-memory buffer (fastest, covers current session)
        const buffered = getTaskTerminalBuffer(rid);
        if (buffered) {
          hasPtyDataRef.current = true;
          terminal.write(buffered);
        } else {
          // 2. Fallback: load persisted buffer from disk (survives app restart)
          window.cerebro.taskTerminal.readBuffer(rid).then((persisted) => {
            if (disposed || !persisted || !termRef.current) return;
            hasPtyDataRef.current = true;
            termRef.current.write(persisted);
          }).catch(() => { /* non-fatal */ });
        }
      }

      // Subscribe DIRECTLY to IPC for live PTY data
      unsubPty = window.cerebro.taskTerminal.onGlobalData((dataRunId, data) => {
        if (dataRunId === runIdRef.current) {
          hasPtyDataRef.current = true;
          termRef.current?.write(data);
        }
      });

      sendResizeIfChanged();
    });

    const handleWindowFocus = () => {
      const buf = terminal.buffer.active;
      if (buf.viewportY >= buf.baseY) return;
      const target = buf.viewportY;
      requestAnimationFrame(() => {
        if (disposed) return;
        const current = terminal.buffer.active.viewportY;
        if (current !== target) terminal.scrollLines(target - current);
      });
    };
    window.addEventListener('focus', handleWindowFocus);

    let resizePending = false;
    const observer = new ResizeObserver(() => {
      if (resizePending || disposed) return;
      resizePending = true;
      requestAnimationFrame(() => {
        resizePending = false;
        if (!disposed) {
          safeFit();
          sendResizeIfChanged();
        }
      });
    });
    observer.observe(containerRef.current);

    // Focus terminal — delay slightly so tab animation settles
    terminal.focus();
    const focusTimer = setTimeout(() => terminal.focus(), 150);

    return () => {
      disposed = true;
      clearTimeout(focusTimer);
      unsubPty?.();
      observer.disconnect();
      window.removeEventListener('focus', handleWindowFocus);
      if (webglAddon) {
        try { webglAddon.dispose(); } catch { /* xterm-internal teardown race */ }
      }
      try { fitAddon.dispose(); } catch { /* teardown race */ }
      terminal.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, [task.id, safeFit, sendResizeIfChanged]);

  // ── Text-delta fallback (completed tasks only) ─────────────
  useEffect(() => {
    const terminal = termRef.current;
    if (!terminal) return;
    if (hasPtyDataRef.current) return;
    if (taskIsActive) return;

    const entries = liveTask?.taskId === task.id ? liveTask.logEntries : [];
    if (entries.length === 0) return;

    const count = entries.length;
    if (count <= writtenCountRef.current) return;

    for (let i = writtenCountRef.current; i < count; i++) {
      const entry = entries[i];
      if (entry.kind === 'text_delta') {
        terminal.write(entry.text);
      }
    }
    writtenCountRef.current = count;
  });

  const handleScrollToBottom = useCallback(() => {
    termRef.current?.scrollToBottom();
    setShowScrollBtn(false);
  }, []);

  const handleResume = useCallback(async () => {
    if (isResuming) return;
    setIsResuming(true);
    try {
      await resumeTask(task.id);
    } catch (err) {
      console.error('Resume failed:', err);
    } finally {
      setIsResuming(false);
    }
  }, [isResuming, resumeTask, task.id]);

  const hasRun = !!runId;
  if (!hasRun) {
    return (
      <div className="flex-1 flex items-center justify-center text-text-tertiary text-sm py-16">
        {t('taskDetail.noOutput')}
      </div>
    );
  }

  return (
    <div className="relative w-full h-full" style={{ padding: '4px' }}>
      <div
        ref={containerRef}
        className="w-full h-full"
        onClick={() => termRef.current?.focus()}
      />
      {taskIsTerminal && (
        <button
          onClick={handleResume}
          disabled={isResuming}
          className="absolute bottom-4 right-4 flex items-center gap-2 px-4 py-2 rounded-lg bg-accent text-white text-xs font-medium hover:bg-accent/90 disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer transition-colors shadow-lg z-10"
          title="Resume this session where it left off"
        >
          {isResuming ? 'Resuming...' : 'Resume'}
          <Play size={14} fill="currentColor" />
        </button>
      )}
      {showScrollBtn && !taskIsTerminal && (
        <button
          onClick={handleScrollToBottom}
          className="absolute bottom-4 right-4 p-2 rounded-full bg-bg-secondary border border-border-subtle text-text-secondary hover:text-text-primary shadow-lg cursor-pointer transition-colors z-10"
        >
          <ArrowDown size={14} />
        </button>
      )}
    </div>
  );
}
