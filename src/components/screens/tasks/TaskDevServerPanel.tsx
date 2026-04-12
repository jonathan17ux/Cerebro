import { useState, useCallback, useEffect, useRef } from 'react';
import { Play, Square, RotateCcw, Loader2, ExternalLink } from 'lucide-react';
import clsx from 'clsx';
import type { Task, TaskDetail } from './types';

interface TaskDevServerPanelProps {
  task: Task;
  detail: TaskDetail | null;
}

type ServerState = 'stopped' | 'starting' | 'running' | 'error';

export default function TaskDevServerPanel({ task, detail }: TaskDevServerPanelProps) {
  const [state, setState] = useState<ServerState>('stopped');
  const [url, setUrl] = useState<string | null>(null);
  const [pid, setPid] = useState<number | null>(null);
  const [output, setOutput] = useState<string[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Hydrate from detail on mount
  useEffect(() => {
    if (detail?.dev_server) {
      if (detail.dev_server.running) {
        setState('running');
        setUrl(detail.dev_server.url ?? null);
        setPid(detail.dev_server.pid ?? null);
      }
    }
  }, [detail?.dev_server]);

  // Auto-scroll output
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [output.length]);

  const handleStart = useCallback(async () => {
    setState('starting');
    setOutput([]);
    setUrl(null);
    try {
      const res = await window.cerebro.invoke<{ task_id: string; pid: number; stream_url: string }>({
        method: 'POST',
        path: `/tasks/${task.id}/dev-server/start`,
      });
      if (res.ok && res.data) {
        setPid(res.data.pid);
        setState('running');
        // Poll status for URL (WebSocket streaming is v2 — use polling for v1)
        const poll = setInterval(async () => {
          const status = await window.cerebro.invoke<{
            running: boolean;
            url: string | null;
            stdout_tail: string | null;
          }>({
            method: 'GET',
            path: `/tasks/${task.id}/dev-server/status`,
          });
          if (status.ok && status.data) {
            if (status.data.url) {
              setUrl(status.data.url);
              clearInterval(poll);
            }
            if (status.data.stdout_tail) {
              setOutput(status.data.stdout_tail.split('\n').slice(-50));
            }
            if (!status.data.running) {
              setState('stopped');
              clearInterval(poll);
            }
          }
        }, 1000);
        // Stop polling after 60s
        setTimeout(() => clearInterval(poll), 60_000);
      } else {
        setState('error');
      }
    } catch {
      setState('error');
    }
  }, [task.id]);

  const handleStop = useCallback(async () => {
    await window.cerebro.invoke({
      method: 'POST',
      path: `/tasks/${task.id}/dev-server/stop`,
    });
    setState('stopped');
    setUrl(null);
    setPid(null);
  }, [task.id]);

  const previewType = task.run_info?.preview_type ?? 'web';

  return (
    <div className="border border-border-subtle rounded-lg overflow-hidden">
      {/* Header */}
      <div className="px-3 py-2 bg-bg-secondary flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span
            className={clsx(
              'w-2 h-2 rounded-full',
              state === 'running' ? 'bg-green-500' :
              state === 'starting' ? 'bg-yellow-500 animate-pulse' :
              state === 'error' ? 'bg-red-500' :
              'bg-zinc-600',
            )}
          />
          <span className="text-xs font-medium text-text-primary">
            Dev Server
          </span>
          <span className="text-[11px] text-text-tertiary">
            ({previewType})
          </span>
          {pid && state === 'running' && (
            <span className="text-[10px] text-text-tertiary">PID {pid}</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {state === 'stopped' || state === 'error' ? (
            <button
              onClick={handleStart}
              className="p-1.5 rounded-md hover:bg-bg-tertiary text-green-500 cursor-pointer transition-colors"
              title="Start dev server"
            >
              <Play size={13} />
            </button>
          ) : state === 'running' ? (
            <>
              <button
                onClick={handleStop}
                className="p-1.5 rounded-md hover:bg-bg-tertiary text-red-400 cursor-pointer transition-colors"
                title="Stop dev server"
              >
                <Square size={13} />
              </button>
              {url && (
                <button
                  onClick={() => {
                    // Open in external browser (the Electron main process handles this)
                    window.open(url, '_blank');
                  }}
                  className="p-1.5 rounded-md hover:bg-bg-tertiary text-text-secondary cursor-pointer transition-colors"
                  title="Open in browser"
                >
                  <ExternalLink size={13} />
                </button>
              )}
            </>
          ) : (
            <Loader2 size={14} className="animate-spin text-yellow-500" />
          )}
        </div>
      </div>

      {/* URL display */}
      {url && state === 'running' && (
        <div className="px-3 py-1.5 bg-green-500/5 border-t border-border-subtle text-xs">
          <span className="text-text-tertiary">URL: </span>
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="text-accent hover:underline"
          >
            {url}
          </a>
        </div>
      )}

      {/* Output */}
      {output.length > 0 && (
        <div
          ref={scrollRef}
          className="max-h-[150px] overflow-y-auto px-3 py-2 border-t border-border-subtle bg-zinc-950/50 font-mono text-[11px] text-zinc-400"
        >
          {output.map((line, i) => (
            <div key={i} className="whitespace-pre-wrap">{line}</div>
          ))}
        </div>
      )}

      {/* Footer: command info */}
      {task.run_info && (
        <div className="px-3 py-1.5 border-t border-border-subtle text-[10px] text-text-tertiary">
          <code>{task.run_info.start_command}</code>
        </div>
      )}
    </div>
  );
}
