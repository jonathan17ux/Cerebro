import clsx from 'clsx';
import type { EventRecord } from './types';
import { formatEventTime } from './helpers';

function describeEvent(evt: EventRecord): string {
  let payload: Record<string, unknown> = {};
  try { payload = JSON.parse(evt.payload_json); } catch { /* empty */ }

  switch (evt.event_type) {
    case 'run_started':
      return `Run started (${payload.total_steps ?? '?'} steps)`;
    case 'run_completed':
      return `Run completed in ${payload.duration_ms ? `${((payload.duration_ms as number) / 1000).toFixed(1)}s` : '?'}`;
    case 'run_failed':
      return `Run failed: ${payload.error ?? 'Unknown error'}`;
    case 'run_cancelled':
      return 'Run cancelled';
    case 'step_started':
      return `Started: ${payload.step_name ?? payload.step_id ?? 'step'}`;
    case 'step_completed':
      return `Completed: ${payload.step_name ?? payload.step_id ?? 'step'}${payload.summary ? ` \u2014 '${payload.summary}'` : ''}`;
    case 'step_failed':
      return `Failed: ${payload.step_name ?? payload.step_id ?? 'step'}${payload.error ? ` \u2014 ${payload.error}` : ''}`;
    case 'step_skipped':
      return `Skipped: ${payload.step_name ?? payload.step_id ?? 'step'}`;
    case 'approval_requested':
      return `Approval requested: ${payload.step_name ?? 'step'}`;
    case 'approval_granted':
      return `Approval granted: ${payload.step_name ?? 'step'}`;
    case 'approval_denied':
      return `Approval denied: ${payload.step_name ?? 'step'}`;
    case 'step_log':
      return `${payload.message ?? String(payload.log ?? evt.event_type)}`;
    default:
      return evt.event_type.replace(/_/g, ' ');
  }
}

function eventColor(eventType: string): string {
  if (eventType.includes('completed') || eventType === 'approval_granted') return 'text-green-500';
  if (eventType.includes('failed') || eventType === 'approval_denied') return 'text-red-400';
  if (eventType === 'approval_requested') return 'text-amber-400';
  if (eventType === 'step_log') return 'text-text-tertiary';
  return 'text-text-secondary';
}

interface EventLogProps {
  events: EventRecord[];
}

export default function EventLog({ events }: EventLogProps) {
  if (events.length === 0) {
    return <p className="text-xs text-text-tertiary">No events recorded.</p>;
  }

  return (
    <div className="space-y-0.5">
      {events.map((evt) => (
        <div key={evt.id} className="flex items-start gap-3 py-1">
          <span className="text-[10px] font-mono tabular-nums text-text-tertiary flex-shrink-0 pt-px">
            {formatEventTime(evt.timestamp)}
          </span>
          <span className={clsx('text-[11px] leading-relaxed', eventColor(evt.event_type))}>
            {describeEvent(evt)}
          </span>
        </div>
      ))}
    </div>
  );
}
