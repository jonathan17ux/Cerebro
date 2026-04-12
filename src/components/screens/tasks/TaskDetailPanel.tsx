import { useState, useEffect, useCallback } from 'react';
import { X, RotateCcw, Trash2, FolderOpen, Terminal, Play, Square } from 'lucide-react';
import clsx from 'clsx';
import { useTasks } from '../../../context/TaskContext';
import { STATUS_CONFIG, formatElapsed, formatPhaseProgress } from './helpers';
import TaskPlanView from './TaskPlanView';
import TaskLogsView from './TaskLogsView';
import TaskDeliverableView from './TaskDeliverableView';
import TaskClarificationPanel from './TaskClarificationPanel';
import TaskWorkspaceView from './TaskWorkspaceView';
import TaskDevServerPanel from './TaskDevServerPanel';
import type { Task, TaskDetail } from './types';

interface TaskDetailPanelProps {
  taskId: string;
}

type TabId = 'plan' | 'logs' | 'deliverable' | 'workspace';

export default function TaskDetailPanel({ taskId }: TaskDetailPanelProps) {
  const { tasks, liveTask, cancelTask, deleteTask, watchTask, unwatchTask, refresh } = useTasks();
  const [detail, setDetail] = useState<TaskDetail | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>('plan');

  const task = tasks.find((t) => t.id === taskId) ?? null;

  // Fetch full detail on mount, id change, or status change (e.g. after finalization)
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const res = await window.cerebro.invoke<TaskDetail>({
        method: 'GET',
        path: `/tasks/${taskId}`,
      });
      if (!cancelled && res.ok) {
        setDetail(res.data);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [taskId, task?.status]);

  // Attach live watcher when task is running
  useEffect(() => {
    if (task && (task.status === 'running' || task.status === 'clarifying')) {
      watchTask(taskId);
    }
    return () => unwatchTask();
  }, [taskId, task?.status]);

  // Refresh detail when live task emits
  useEffect(() => {
    if (liveTask && liveTask.taskId === taskId) {
      // Periodic detail refresh for persisted state
      const timer = setInterval(() => {
        window.cerebro.invoke<TaskDetail>({
          method: 'GET',
          path: `/tasks/${taskId}`,
        }).then((res) => {
          if (res.ok) setDetail(res.data);
        });
      }, 3000);
      return () => clearInterval(timer);
    }
  }, [taskId, liveTask?.taskId]);

  const handleCancel = useCallback(async () => {
    await cancelTask(taskId);
  }, [cancelTask, taskId]);

  const handleDelete = useCallback(async () => {
    await deleteTask(taskId);
  }, [deleteTask, taskId]);

  if (!task) {
    return (
      <div className="flex-1 flex items-center justify-center text-text-tertiary text-sm">
        Task not found
      </div>
    );
  }

  const style = STATUS_CONFIG[task.status] ?? STATUS_CONFIG.pending;
  const isActive = task.status === 'running' || task.status === 'clarifying' || task.status === 'planning';
  const isTerminal = task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled';
  const showClarification = task.status === 'awaiting_clarification';

  const hasWorkspace = task.deliverable_kind === 'code_app' || task.deliverable_kind === 'mixed';
  const tabs: Array<{ id: TabId; label: string }> = [
    { id: 'plan', label: 'Plan' },
    { id: 'logs', label: 'Logs' },
    { id: 'deliverable', label: 'Deliverable' },
    ...(hasWorkspace ? [{ id: 'workspace' as const, label: 'Workspace' }] : []),
  ];

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Header */}
      <div className="px-5 pt-4 pb-3 border-b border-border-subtle">
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-base font-semibold text-text-primary truncate flex-1 mr-4">
            {task.title}
          </h2>
          <div className="flex items-center gap-1.5">
            {isActive && (
              <button
                onClick={handleCancel}
                className="p-1.5 rounded-md hover:bg-bg-secondary text-text-tertiary hover:text-red-400 transition-colors cursor-pointer"
                title="Cancel task"
              >
                <Square size={14} />
              </button>
            )}
            {isTerminal && (
              <button
                onClick={handleDelete}
                className="p-1.5 rounded-md hover:bg-bg-secondary text-text-tertiary hover:text-red-400 transition-colors cursor-pointer"
                title="Delete task"
              >
                <Trash2 size={14} />
              </button>
            )}
          </div>
        </div>

        <p className="text-xs text-text-tertiary line-clamp-2 mb-2">{task.goal}</p>

        <div className="flex items-center gap-3 text-xs">
          <span className={clsx('flex items-center gap-1.5', style.text)}>
            <span
              className={clsx('w-1.5 h-1.5 rounded-full', style.dot)}
              style={style.glow ? { boxShadow: '0 0 6px currentColor' } : undefined}
            />
            {style.label}
          </span>
          {task.plan && (
            <span className="text-text-tertiary">{formatPhaseProgress(task.plan)}</span>
          )}
          {(task.started_at || task.completed_at) && (
            <span className="text-text-tertiary">
              {formatElapsed(task.started_at, task.completed_at)}
            </span>
          )}
        </div>
      </div>

      {/* Clarification overlay */}
      {showClarification && task.clarifications?.questions ? (
        <TaskClarificationPanel
          taskId={taskId}
          questions={task.clarifications.questions}
          goal={task.goal}
        />
      ) : (
        <>
          {/* Tabs */}
          <div className="px-5 pt-2 flex gap-4 border-b border-border-subtle">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={clsx(
                  'pb-2 text-sm font-medium border-b-2 transition-colors cursor-pointer',
                  activeTab === tab.id
                    ? 'border-accent text-text-primary'
                    : 'border-transparent text-text-tertiary hover:text-text-secondary',
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Tab content */}
          <div className="flex-1 overflow-y-auto min-h-0">
            {activeTab === 'plan' && (
              <TaskPlanView task={task} liveTask={liveTask} />
            )}
            {activeTab === 'logs' && (
              <TaskLogsView task={task} liveTask={liveTask} />
            )}
            {activeTab === 'deliverable' && (
              <TaskDeliverableView task={task} detail={detail} />
            )}
            {activeTab === 'workspace' && hasWorkspace && (
              <TaskWorkspaceView task={task} />
            )}
          </div>
        </>
      )}
    </div>
  );
}
