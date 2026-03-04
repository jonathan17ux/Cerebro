import { useState, useEffect } from 'react';
import {
  ChevronRight,
  CheckCircle2,
  XCircle,
  Loader2,
  SkipForward,
  Clock,
} from 'lucide-react';
import clsx from 'clsx';
import type { ExecutionEvent } from '../../engine/events/types';

type RunStatus = 'running' | 'completed' | 'failed' | 'cancelled';

interface StepState {
  id: string;
  name: string;
  actionType?: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'skipped';
  summary?: string;
  error?: string;
  durationMs?: number;
}

interface RunLogCardProps {
  engineRunId: string;
}

function StepIcon({ status }: { status: StepState['status'] }) {
  switch (status) {
    case 'running':
      return <Loader2 size={12} className="animate-spin text-yellow-500" />;
    case 'completed':
      return <CheckCircle2 size={12} className="text-green-500" />;
    case 'failed':
      return <XCircle size={12} className="text-red-500" />;
    case 'skipped':
      return <SkipForward size={12} className="text-text-tertiary" />;
    case 'queued':
      return <Clock size={12} className="text-zinc-400" />;
  }
}

function RunStatusIcon({ status }: { status: RunStatus }) {
  switch (status) {
    case 'running':
      return <Loader2 size={14} className="animate-spin text-yellow-500" />;
    case 'completed':
      return <CheckCircle2 size={14} className="text-green-500" />;
    case 'failed':
      return <XCircle size={14} className="text-red-500" />;
    case 'cancelled':
      return <XCircle size={14} className="text-text-tertiary" />;
  }
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export default function RunLogCard({ engineRunId }: RunLogCardProps) {
  const [runStatus, setRunStatus] = useState<RunStatus>('running');
  const [steps, setSteps] = useState<StepState[]>([]);
  const [totalSteps, setTotalSteps] = useState(0);
  const [isExpanded, setIsExpanded] = useState(true);

  useEffect(() => {
    const unsub = window.cerebro.engine.onEvent(engineRunId, (event: ExecutionEvent) => {
      switch (event.type) {
        case 'run_started':
          setTotalSteps(event.totalSteps);
          break;

        case 'step_queued':
          setSteps((prev) => [
            ...prev,
            { id: event.stepId, name: event.stepName, status: 'queued' as const },
          ]);
          break;

        case 'step_started':
          setSteps((prev) =>
            prev.map((s) =>
              s.id === event.stepId ? { ...s, status: 'running' as const, actionType: event.actionType } : s,
            ),
          );
          break;

        case 'step_completed':
          setSteps((prev) =>
            prev.map((s) =>
              s.id === event.stepId
                ? { ...s, status: 'completed' as const, summary: event.summary, durationMs: event.durationMs }
                : s,
            ),
          );
          break;

        case 'step_failed':
          setSteps((prev) =>
            prev.map((s) =>
              s.id === event.stepId ? { ...s, status: 'failed' as const, error: event.error } : s,
            ),
          );
          break;

        case 'step_skipped':
          setSteps((prev) =>
            prev.map((s) =>
              s.id === event.stepId ? { ...s, status: 'skipped' as const } : s,
            ),
          );
          break;

        case 'run_completed':
          setRunStatus('completed');
          break;

        case 'run_failed':
          setRunStatus('failed');
          break;

        case 'run_cancelled':
          setRunStatus('cancelled');
          break;
      }
    });

    return unsub;
  }, [engineRunId]);

  const completedCount = steps.filter(
    (s) => s.status === 'completed' || s.status === 'failed' || s.status === 'skipped',
  ).length;
  const displayTotal = totalSteps || steps.length;

  const statusLabel =
    runStatus === 'running'
      ? 'Running'
      : runStatus === 'completed'
        ? 'Completed'
        : runStatus === 'failed'
          ? 'Failed'
          : 'Cancelled';

  return (
    <div className="animate-fade-in rounded-lg border overflow-hidden border-border-default bg-bg-surface/50">
      {/* Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-bg-hover/50 transition-colors duration-150 cursor-pointer"
      >
        <RunStatusIcon status={runStatus} />
        <span className="flex-1 text-xs font-medium text-text-secondary">Routine Run</span>
        <span className="text-[10px] text-text-tertiary">
          {completedCount}/{displayTotal} steps
        </span>
        <ChevronRight
          size={12}
          className={clsx(
            'text-text-tertiary transition-transform duration-200 flex-shrink-0',
            isExpanded && 'rotate-90',
          )}
        />
      </button>

      {/* Step list */}
      {isExpanded && steps.length > 0 && (
        <div className="border-t border-border-subtle px-3 py-2 space-y-1.5">
          {steps.map((step, i) => (
            <div
              key={step.id}
              className="animate-step-in flex items-start gap-2"
              style={{ animationDelay: `${i * 50}ms` }}
            >
              <div className="mt-0.5 flex-shrink-0">
                <StepIcon status={step.status} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span
                    className={clsx(
                      'text-xs truncate',
                      step.status === 'skipped' ? 'text-text-tertiary' : 'text-text-secondary',
                    )}
                  >
                    {step.name}
                  </span>
                  {step.durationMs != null && (
                    <span className="text-[10px] text-text-tertiary flex-shrink-0">
                      {formatDuration(step.durationMs)}
                    </span>
                  )}
                </div>
                {step.summary && (
                  <p className="text-[10px] text-text-tertiary truncate mt-0.5">{step.summary}</p>
                )}
                {step.error && (
                  <p className="text-[10px] text-red-400 mt-0.5">{step.error}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Status bar when collapsed or complete */}
      {!isExpanded && runStatus !== 'running' && (
        <div className="border-t border-border-subtle px-3 py-1.5">
          <span
            className={clsx(
              'text-[10px]',
              runStatus === 'completed' && 'text-green-500',
              runStatus === 'failed' && 'text-red-500',
              runStatus === 'cancelled' && 'text-text-tertiary',
            )}
          >
            {statusLabel}
          </span>
        </div>
      )}
    </div>
  );
}
