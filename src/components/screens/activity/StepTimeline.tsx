import { CheckCircle2, XCircle, Loader2, SkipForward, Clock } from 'lucide-react';
import type { StepRecord } from './types';
import { formatDuration } from './helpers';

function StepIcon({ status }: { status: string }) {
  switch (status) {
    case 'running':
      return <Loader2 size={12} className="animate-spin text-yellow-500" />;
    case 'completed':
      return <CheckCircle2 size={12} className="text-green-500" />;
    case 'failed':
      return <XCircle size={12} className="text-red-500" />;
    case 'skipped':
      return <SkipForward size={12} className="text-text-tertiary" />;
    default:
      return <Clock size={12} className="text-zinc-400" />;
  }
}

interface StepTimelineProps {
  steps: StepRecord[];
}

export default function StepTimeline({ steps }: StepTimelineProps) {
  const sorted = [...steps].sort((a, b) => a.order_index - b.order_index);

  if (sorted.length === 0) {
    return <p className="text-xs text-text-tertiary">No steps recorded.</p>;
  }

  return (
    <div className="space-y-1">
      {sorted.map((step, i) => (
        <div
          key={step.id}
          className="flex items-start gap-2.5 py-2 animate-step-in"
          style={{ animationDelay: `${i * 50}ms` }}
        >
          {/* Step number */}
          <span className="w-4 text-right text-[10px] tabular-nums text-text-tertiary pt-px flex-shrink-0">
            {i + 1}
          </span>

          {/* Icon */}
          <div className="pt-px flex-shrink-0">
            <StepIcon status={step.status} />
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-xs text-text-primary truncate">{step.step_name}</span>
              <span className="text-[10px] tabular-nums text-text-tertiary flex-shrink-0">
                {formatDuration(step.duration_ms)}
              </span>
            </div>
            {step.summary && (
              <p className="text-[11px] text-text-secondary mt-0.5 line-clamp-2 italic">
                &ldquo;{step.summary}&rdquo;
              </p>
            )}
            {step.error && (
              <p className="text-[11px] text-red-400 mt-0.5 line-clamp-2">
                {step.error}
              </p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
