import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { CheckCircle2, Circle, Loader2, XCircle, SkipForward } from 'lucide-react';
import type { Task, PlanPhase } from './types';
import type { LiveTaskState } from './types';

// Re-export for TaskDetailPanel's use
export type { LiveTaskState };

interface TaskPlanViewProps {
  task: Task;
  liveTask: {
    plan: { phases: PlanPhase[] } | null;
    phases: Record<string, { status: string; name: string; summary: string | null }>;
    activePhaseId: string | null;
    deliverableKind: string | null;
  } | null;
}

const STATUS_ICON = {
  pending:   Circle,
  running:   Loader2,
  completed: CheckCircle2,
  failed:    XCircle,
  skipped:   SkipForward,
} as const;

const STATUS_COLOR = {
  pending:   'text-text-tertiary',
  running:   'text-yellow-500',
  completed: 'text-green-500',
  failed:    'text-red-500',
  skipped:   'text-zinc-500',
} as const;

export default function TaskPlanView({ task, liveTask }: TaskPlanViewProps) {
  const { t } = useTranslation();
  // Prefer live state over persisted
  const plan = liveTask?.plan ?? task.plan;
  const livePhases = liveTask?.phases ?? {};
  const deliverableKind = liveTask?.deliverableKind ?? task.deliverable_kind;

  if (!plan || plan.phases.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center py-16 text-text-tertiary text-sm">
        {task.status === 'running' || task.status === 'clarifying' ? (
          <div className="flex items-center gap-2">
            <Loader2 size={16} className="animate-spin" />
            <span>Cerebro is building a plan...</span>
          </div>
        ) : (
          <span>No plan available</span>
        )}
      </div>
    );
  }

  return (
    <div className="px-5 py-4">
      {/* Kind badge */}
      {deliverableKind && (
        <div className="mb-4">
          <span className="text-[11px] uppercase tracking-wider font-medium px-2 py-0.5 rounded bg-accent/10 text-accent">
            {deliverableKind === 'code_app' ? t('taskDetail.codeApp') : deliverableKind === 'mixed' ? t('taskDetail.mixed') : t('taskDetail.markdown')}
          </span>
        </div>
      )}

      {/* Phase list */}
      <div className="space-y-1">
        {plan.phases.map((phase, i) => {
          const liveState = livePhases[phase.id];
          const status = liveState?.status ?? phase.status;
          const summary = liveState?.summary ?? phase.summary;
          const Icon = STATUS_ICON[status as keyof typeof STATUS_ICON] ?? Circle;
          const color = STATUS_COLOR[status as keyof typeof STATUS_COLOR] ?? 'text-text-tertiary';
          const isRunning = status === 'running';

          return (
            <div
              key={phase.id}
              className={clsx(
                'flex items-start gap-3 px-3 py-2.5 rounded-lg transition-colors',
                isRunning && 'bg-yellow-500/5 ring-1 ring-yellow-500/20',
              )}
            >
              <div className={clsx('mt-0.5 flex-shrink-0', color)}>
                <Icon size={16} className={isRunning ? 'animate-spin' : ''} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-text-primary">{phase.name}</span>
                  {phase.expert_slug && (
                    <span className="text-[11px] px-1.5 py-0.5 rounded bg-bg-secondary text-text-tertiary">
                      {phase.expert_slug}
                    </span>
                  )}
                  {phase.needs_new_expert && (
                    <span className="text-[11px] px-1.5 py-0.5 rounded bg-accent/10 text-accent">
                      NEW
                    </span>
                  )}
                </div>
                <p className="text-xs text-text-tertiary mt-0.5">{phase.description}</p>
                {summary && (
                  <p className="text-xs text-text-secondary mt-1 italic">{summary}</p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
