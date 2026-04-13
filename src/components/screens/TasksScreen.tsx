import { useState, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus } from 'lucide-react';
import clsx from 'clsx';
import { useTasks } from '../../context/TaskContext';
import TaskListCard from './tasks/TaskListCard';
import TaskDetailPanel from './tasks/TaskDetailPanel';
import TaskEmptyState from './tasks/TaskEmptyState';
import NewTaskDialog from './tasks/NewTaskDialog';
import type { TaskStatus } from './tasks/types';

const STATUS_FILTERS: Array<{ key: string; value: TaskStatus | 'all' }> = [
  { key: 'tasks.filterAll', value: 'all' },
  { key: 'tasks.filterRunning', value: 'running' },
  { key: 'tasks.filterDone', value: 'completed' },
  { key: 'tasks.filterFailed', value: 'failed' },
];

export default function TasksScreen() {
  const { t } = useTranslation();
  const {
    tasks,
    selectedTaskId,
    setSelectedTaskId,
    createAndRunTask,
  } = useTasks();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogGoal, setDialogGoal] = useState('');
  const [statusFilter, setStatusFilter] = useState<TaskStatus | 'all'>('all');

  const filteredTasks = useMemo(() => {
    if (statusFilter === 'all') return tasks;
    if (statusFilter === 'running') {
      return tasks.filter((t) =>
        t.status === 'running' ||
        t.status === 'clarifying' ||
        t.status === 'awaiting_clarification' ||
        t.status === 'planning',
      );
    }
    return tasks.filter((t) => t.status === statusFilter);
  }, [tasks, statusFilter]);

  const handleSuggestionClick = useCallback((text: string) => {
    setDialogGoal(text);
    setDialogOpen(true);
  }, []);

  const handleNewTask = useCallback(() => {
    setDialogGoal('');
    setDialogOpen(true);
  }, []);

  const handleSubmit = useCallback(async (input: {
    title: string;
    goal: string;
    templateId?: string;
    skipClarification: boolean;
    maxPhases: number;
    maxTurns: number;
    model?: string;
  }) => {
    try {
      await createAndRunTask({
        title: input.title,
        goal: input.goal,
        templateId: input.templateId,
        skipClarification: input.skipClarification,
        maxPhases: input.maxPhases,
        maxTurns: input.maxTurns,
        model: input.model,
      });
    } catch (err) {
      console.error('Failed to create task:', err);
    }
  }, [createAndRunTask]);

  return (
    <div className="flex-1 flex min-h-0">
      {/* Left panel — task list */}
      <div className="w-[340px] flex-shrink-0 border-r border-border-subtle flex flex-col">
        {/* Header */}
        <div className="px-4 pt-3 pb-2 flex items-center justify-between">
          <h1 className="text-base font-semibold text-text-primary">{t('tasks.title')}</h1>
          <button
            onClick={handleNewTask}
            className="p-1.5 rounded-md bg-accent/10 hover:bg-accent/20 text-accent transition-colors cursor-pointer"
            title={t('tasks.newTask')}
          >
            <Plus size={16} />
          </button>
        </div>

        {/* Filter tabs */}
        <div className="px-4 pb-2 flex gap-1">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => setStatusFilter(f.value)}
              className={clsx(
                'text-xs px-2 py-1 rounded-md transition-colors cursor-pointer',
                statusFilter === f.value
                  ? 'bg-accent/15 text-accent font-medium'
                  : 'text-text-tertiary hover:text-text-secondary',
              )}
            >
              {t(f.key)}
            </button>
          ))}
        </div>

        {/* Task list */}
        <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-0.5">
          {filteredTasks.length === 0 ? (
            <p className="text-xs text-text-tertiary text-center mt-8">
              {statusFilter === 'all' ? t('tasks.noTasksYet') : t('tasks.noFilteredTasks', { status: statusFilter })}
            </p>
          ) : (
            filteredTasks.map((task) => (
              <TaskListCard
                key={task.id}
                task={task}
                isSelected={task.id === selectedTaskId}
                onClick={() => setSelectedTaskId(task.id)}
              />
            ))
          )}
        </div>
      </div>

      {/* Right panel — detail or empty state */}
      <div className="flex-1 flex flex-col min-h-0">
        {selectedTaskId ? (
          <TaskDetailPanel taskId={selectedTaskId} />
        ) : (
          <TaskEmptyState onSuggestionClick={handleSuggestionClick} />
        )}
      </div>

      {/* New task dialog */}
      <NewTaskDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onSubmit={handleSubmit}
        initialGoal={dialogGoal}
      />
    </div>
  );
}
