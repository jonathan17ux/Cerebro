import { Loader2 } from 'lucide-react';
import MarkdownContent from '../../chat/MarkdownContent';
import TaskDevServerPanel from './TaskDevServerPanel';
import type { Task, TaskDetail } from './types';

interface TaskDeliverableViewProps {
  task: Task;
  detail: TaskDetail | null;
}

export default function TaskDeliverableView({ task, detail }: TaskDeliverableViewProps) {
  const isRunning = task.status === 'running' || task.status === 'clarifying' || task.status === 'planning';

  if (!task.deliverable_markdown) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center py-16 text-text-tertiary text-sm">
        {isRunning ? (
          <div className="flex items-center gap-2">
            <Loader2 size={16} className="animate-spin" />
            <span>Your deliverable will appear when Cerebro finishes</span>
          </div>
        ) : (
          <span>No deliverable</span>
        )}
      </div>
    );
  }

  return (
    <div className="px-5 py-4">
      {task.deliverable_title && (
        <h3 className="text-lg font-semibold text-text-primary mb-3">
          {task.deliverable_title}
        </h3>
      )}
      {task.deliverable_kind !== 'markdown' && (
        <div className="mb-3">
          <span className="text-[11px] uppercase tracking-wider font-medium px-2 py-0.5 rounded bg-accent/10 text-accent">
            {task.deliverable_kind === 'code_app' ? 'Code App' : 'Mixed'}
          </span>
        </div>
      )}
      {/* Dev server panel for code apps */}
      {(task.deliverable_kind === 'code_app' || task.deliverable_kind === 'mixed') && task.run_info && (
        <div className="mb-4">
          <TaskDevServerPanel task={task} detail={detail} />
        </div>
      )}

      <div className="prose prose-invert prose-sm max-w-none">
        <MarkdownContent content={task.deliverable_markdown} />
      </div>
    </div>
  );
}
