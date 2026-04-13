import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { useTasks } from '../../../context/TaskContext';
import type { ClarificationQuestion } from './types';

interface TaskClarificationPanelProps {
  taskId: string;
  questions: ClarificationQuestion[];
  goal: string;
}

export default function TaskClarificationPanel({
  taskId,
  questions,
  goal,
}: TaskClarificationPanelProps) {
  const { t } = useTranslation();
  const { submitClarification } = useTasks();
  const [answers, setAnswers] = useState<Record<string, string | boolean>>(() => {
    const initial: Record<string, string | boolean> = {};
    for (const q of questions) {
      if (q.default != null) {
        initial[q.id] = q.default;
      } else if (q.kind === 'bool') {
        initial[q.id] = false;
      } else {
        initial[q.id] = '';
      }
    }
    return initial;
  });
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = useCallback(async () => {
    setSubmitting(true);
    try {
      const answerList = questions.map((q) => ({
        id: q.id,
        answer: answers[q.id] ?? '',
      }));
      await submitClarification(taskId, answerList);
    } catch (err) {
      console.error('Failed to submit clarification:', err);
    } finally {
      setSubmitting(false);
    }
  }, [answers, questions, submitClarification, taskId]);

  const handleSkip = useCallback(async () => {
    setSubmitting(true);
    try {
      const answerList = questions.map((q) => ({ id: q.id, answer: '' }));
      await submitClarification(taskId, answerList);
    } catch (err) {
      console.error('Failed to skip clarification:', err);
    } finally {
      setSubmitting(false);
    }
  }, [questions, submitClarification, taskId]);

  return (
    <div className="flex-1 flex flex-col px-5 py-5">
      <h3 className="text-sm font-semibold text-text-primary mb-1">
        Cerebro has a few questions before it starts.
      </h3>
      <blockquote className="text-xs text-text-tertiary border-l-2 border-border-subtle pl-3 mb-5 line-clamp-3">
        {goal}
      </blockquote>

      <div className="space-y-4 flex-1">
        {questions.map((q) => (
          <div key={q.id}>
            <label className="text-sm text-text-primary font-medium mb-1.5 block">
              {q.q}
            </label>
            {q.kind === 'text' && (
              <textarea
                value={String(answers[q.id] ?? '')}
                onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })}
                placeholder={q.placeholder ?? ''}
                className="w-full bg-bg-secondary border border-border-subtle rounded-md px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary resize-none focus:outline-none focus:ring-1 focus:ring-accent/50 min-h-[60px]"
                rows={2}
              />
            )}
            {q.kind === 'select' && q.options && (
              <div className="flex flex-wrap gap-1.5">
                {q.options.map((opt) => (
                  <button
                    key={opt}
                    onClick={() => setAnswers({ ...answers, [q.id]: opt })}
                    className={clsx(
                      'text-xs px-3 py-1.5 rounded-md border transition-colors cursor-pointer',
                      answers[q.id] === opt
                        ? 'bg-accent/15 border-accent/30 text-accent'
                        : 'bg-bg-secondary border-border-subtle text-text-secondary hover:text-text-primary',
                    )}
                  >
                    {opt}
                  </button>
                ))}
              </div>
            )}
            {q.kind === 'bool' && (
              <button
                onClick={() => setAnswers({ ...answers, [q.id]: !answers[q.id] })}
                className={clsx(
                  'relative w-9 h-5 rounded-full transition-colors cursor-pointer',
                  answers[q.id] ? 'bg-accent' : 'bg-zinc-600',
                )}
              >
                <div
                  className={clsx(
                    'absolute top-[3px] w-[14px] h-[14px] rounded-full bg-white transition-transform',
                    answers[q.id] ? 'translate-x-[18px]' : 'translate-x-[3px]',
                  )}
                />
              </button>
            )}
          </div>
        ))}
      </div>

      {/* Footer actions */}
      <div className="flex items-center justify-end gap-2 pt-4 border-t border-border-subtle mt-4">
        <button
          onClick={handleSkip}
          disabled={submitting}
          className="px-3 py-1.5 text-sm rounded-md text-text-secondary hover:text-text-primary transition-colors cursor-pointer disabled:opacity-50"
        >
          You decide everything
        </button>
        <button
          onClick={handleSubmit}
          disabled={submitting}
          className="px-4 py-1.5 text-sm rounded-md bg-accent text-white font-medium hover:bg-accent/90 disabled:opacity-50 transition-colors cursor-pointer"
        >
          {submitting ? t('taskDetail.starting') : t('taskDetail.start')}
        </button>
      </div>
    </div>
  );
}
