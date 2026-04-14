/**
 * TaskPreviewView — live preview of the built app.
 *
 * During execution: polls the workspace for previewable files (HTML) and
 * updates the iframe in real-time as content changes, giving users a
 * live "watching it build" experience.
 *
 * For web apps: auto-starts the dev server when run_info is detected
 * (even during execution) and shows an embedded iframe.
 * For static HTML: loads the best HTML file via blob URL, updating on
 * mtime changes.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Play, Square, Loader2, ExternalLink, RefreshCw, RotateCcw } from 'lucide-react';
import type { LiveTaskState } from '../../../context/TaskContext';
import type { Task, TaskDetail, RunInfo } from './types';

interface TaskPreviewViewProps {
  task: Task;
  detail: TaskDetail | null;
  liveTask: LiveTaskState | null;
}

type ServerState = 'stopped' | 'starting' | 'running' | 'error';

const LIVE_POLL_INTERVAL_MS = 1500;

export default function TaskPreviewView({ task, detail, liveTask }: TaskPreviewViewProps) {
  const { t } = useTranslation();
  const [state, setState] = useState<ServerState>('stopped');
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const blobUrlRef = useRef<string | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Live preview polling refs
  const livePollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const liveMtimeRef = useRef<number | null>(null);
  const livePathRef = useRef<string | null>(null);
  const devServerStartedRef = useRef(false);

  const isRunning = task.status === 'running' || task.status === 'clarifying' || task.status === 'planning';

  const revokeBlobUrl = () => {
    if (blobUrlRef.current) { URL.revokeObjectURL(blobUrlRef.current); blobUrlRef.current = null; }
  };

  // ── Callbacks (defined before effects that use them) ──────────

  const stopPolling = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    if (timeoutRef.current) { clearTimeout(timeoutRef.current); timeoutRef.current = null; }
  }, []);

  const stopLivePolling = useCallback(() => {
    if (livePollRef.current) { clearInterval(livePollRef.current); livePollRef.current = null; }
  }, []);

  // Unified handler: when runInfoOverride is provided, it's passed in
  // the request body (live mode before finalization). Otherwise falls
  // back to task.run_info from DB.
  const handleStart = useCallback(async (runInfoOverride?: RunInfo) => {
    stopPolling();
    setState('starting');
    setError(null);
    setUrl(null);
    revokeBlobUrl();

    const effectiveRunInfo = runInfoOverride ?? task.run_info;

    try {
      // Static preview: load HTML directly via blob URL
      if (effectiveRunInfo?.preview_type === 'static') {
        const res = await window.cerebro.invoke<{ content: string }>({
          method: 'GET',
          path: `/tasks/${task.id}/workspace/file?path=index.html`,
        });
        if (res.ok && res.data?.content) {
          const blobUrl = URL.createObjectURL(new Blob([res.data.content], { type: 'text/html' }));
          blobUrlRef.current = blobUrl;
          setUrl(blobUrl);
          setState('running');
          return;
        }
      }

      // Dev server: start and poll for URL
      const res = await window.cerebro.invoke<{ task_id: string; pid: number }>({
        method: 'POST',
        path: `/tasks/${task.id}/dev-server/start`,
        body: runInfoOverride ? { run_info: runInfoOverride } : undefined,
      });

      if (!res.ok) {
        setState('error');
        setError(t('taskDetail.failedToStartPreview'));
        return;
      }

      pollRef.current = setInterval(async () => {
        const status = await window.cerebro.invoke<{
          running: boolean;
          url: string | null;
        }>({
          method: 'GET',
          path: `/tasks/${task.id}/dev-server/status`,
        });

        if (status.ok && status.data) {
          if (status.data.url) {
            setUrl(status.data.url);
            setState('running');
            stopPolling();
          }
          if (!status.data.running) {
            setState('error');
            setError(t('taskDetail.previewStopped'));
            stopPolling();
          }
        }
      }, 1000);

      timeoutRef.current = setTimeout(() => stopPolling(), 90_000);
    } catch {
      setState('error');
      setError(t('taskDetail.failedToStartPreview'));
    }
  }, [task.id, task.run_info, stopPolling, t]);

  const handleStop = useCallback(async () => {
    if (pollRef.current) clearInterval(pollRef.current);
    await window.cerebro.invoke({
      method: 'POST',
      path: `/tasks/${task.id}/dev-server/stop`,
    });
    setState('stopped');
    setUrl(null);
  }, [task.id]);

  const handleReload = useCallback(() => {
    if (iframeRef.current && url) {
      iframeRef.current.src = url;
    }
  }, [url]);

  // ── Effects ───────────────────────────────────────────────────

  // Hydrate from existing dev server state
  useEffect(() => {
    if (detail?.dev_server?.running && detail.dev_server.url) {
      setState('running');
      setUrl(detail.dev_server.url);
    }
  }, [detail?.dev_server]);

  // Auto-start on mount if task is complete and has run_info
  useEffect(() => {
    if (!isRunning && state === 'stopped' && task.run_info && !detail?.dev_server?.running) {
      handleStart();
    }
    return () => {
      stopPolling();
      stopLivePolling();
      revokeBlobUrl();
    };
  }, []);

  // Live preview polling during execution
  useEffect(() => {
    if (!isRunning) {
      stopLivePolling();
      liveMtimeRef.current = null;
      livePathRef.current = null;
      devServerStartedRef.current = false;
      return;
    }

    // Don't poll if dev server is already handling preview
    if (devServerStartedRef.current) return;

    let aborted = false;

    const poll = async () => {
      try {
        const params = new URLSearchParams();
        if (livePathRef.current) params.set('known_path', livePathRef.current);
        if (liveMtimeRef.current != null) params.set('if_mtime_neq', String(liveMtimeRef.current));
        const qs = params.toString();

        const res = await window.cerebro.invoke<{
          found: boolean;
          path: string | null;
          content: string | null;
          mtime: number | null;
        }>({
          method: 'GET',
          path: `/tasks/${task.id}/workspace/preview-file${qs ? `?${qs}` : ''}`,
        });

        if (aborted) return;

        if (res.ok && res.data?.found) {
          if (res.data.path) livePathRef.current = res.data.path;

          // Content is null when mtime matched (no change)
          if (res.data.content && res.data.mtime !== liveMtimeRef.current) {
            liveMtimeRef.current = res.data.mtime;
            revokeBlobUrl();
            const newBlobUrl = URL.createObjectURL(
              new Blob([res.data.content], { type: 'text/html' }),
            );
            blobUrlRef.current = newBlobUrl;
            setUrl(newBlobUrl);
            setState('running');
          }
        }
      } catch {
        // File not yet created — keep polling
      }
    };

    poll();
    livePollRef.current = setInterval(poll, LIVE_POLL_INTERVAL_MS);

    return () => { aborted = true; stopLivePolling(); };
  }, [isRunning, task.id, stopLivePolling]);

  // Early dev server start when run_info detected during execution
  useEffect(() => {
    if (!isRunning || !liveTask?.runInfo || devServerStartedRef.current) return;
    const { preview_type } = liveTask.runInfo;

    if (preview_type === 'web' || preview_type === 'expo') {
      devServerStartedRef.current = true;
      stopLivePolling();
      handleStart(liveTask.runInfo);
    }
  }, [liveTask?.runInfo, isRunning, stopLivePolling, handleStart]);

  // ── Render ────────────────────────────────────────────────────

  // During execution, before any content is found
  if (isRunning && state === 'stopped' && !url) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-text-tertiary text-sm">
        <Loader2 size={18} className="animate-spin mb-2 opacity-50" />
        <span>{t('taskDetail.watchingForContent')}</span>
        <span className="text-xs mt-1 opacity-50">
          {t('taskDetail.watchingForContentHint')}
        </span>
      </div>
    );
  }

  // Starting dev server
  if (state === 'starting') {
    const startCommand = task.run_info?.start_command ?? liveTask?.runInfo?.start_command;
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-text-tertiary text-sm">
        <Loader2 size={20} className="animate-spin mb-3" />
        <span>Starting preview...</span>
        {startCommand && (
          <code className="text-xs mt-1 text-text-tertiary font-mono">
            {startCommand}
          </code>
        )}
      </div>
    );
  }

  // Error
  if (state === 'error') {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-text-tertiary text-sm gap-3">
        <span className="text-red-400">{error || t('taskDetail.previewFailed')}</span>
        <button
          onClick={() => handleStart()}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-bg-secondary text-text-secondary hover:text-text-primary text-xs cursor-pointer transition-colors"
        >
          <RotateCcw size={12} /> Retry
        </button>
      </div>
    );
  }

  // Running with URL — show iframe
  if (url) {
    return (
      <div className="flex-1 flex flex-col min-h-0">
        {/* Browser bar */}
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border-subtle bg-bg-surface">
          <div className="flex items-center gap-1">
            <button
              onClick={handleReload}
              className="p-1 rounded hover:bg-bg-hover text-text-tertiary hover:text-text-secondary cursor-pointer transition-colors"
              title="Reload"
            >
              <RefreshCw size={12} />
            </button>
            {!isRunning && (
              <button
                onClick={handleStop}
                className="p-1 rounded hover:bg-bg-hover text-text-tertiary hover:text-red-400 cursor-pointer transition-colors"
                title="Stop server"
              >
                <Square size={12} />
              </button>
            )}
          </div>
          <div className="flex-1 px-2 py-0.5 rounded bg-bg-base border border-border-subtle text-xs text-text-tertiary font-mono truncate">
            {url.startsWith('blob:') ? 'index.html' : url}
          </div>
          {isRunning && (
            <span className="flex items-center gap-1 text-xs text-accent">
              <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
              Live
            </span>
          )}
          <button
            onClick={() => {
              if (url.startsWith('blob:') && task.workspace_path) {
                // Static preview: open the actual file from the workspace
                window.cerebro.shell.openPath(`${task.workspace_path}/index.html`);
              } else if (!url.startsWith('blob:')) {
                window.open(url, '_blank');
              }
            }}
            className="p-1 rounded hover:bg-bg-hover text-text-tertiary hover:text-text-secondary cursor-pointer transition-colors"
            title="Open in browser"
          >
            <ExternalLink size={12} />
          </button>
        </div>

        <iframe
          ref={iframeRef}
          src={url}
          className="flex-1 w-full bg-white border-0"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
          title="App preview"
        />
      </div>
    );
  }

  // Stopped — no run_info or not started
  if (!task.run_info) {
    return (
      <div className="flex-1 flex items-center justify-center text-text-tertiary text-sm">
        No preview available for this task
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col items-center justify-center text-text-tertiary text-sm gap-3">
      <button
        onClick={() => handleStart()}
        className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-accent text-white text-sm font-medium cursor-pointer hover:bg-accent/80 transition-colors"
      >
        <Play size={14} /> Start Preview
      </button>
    </div>
  );
}
