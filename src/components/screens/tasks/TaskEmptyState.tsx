import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Target } from 'lucide-react';

interface TaskEmptyStateProps {
  onSuggestionClick: (text: string) => void;
}

export default function TaskEmptyState({ onSuggestionClick }: TaskEmptyStateProps) {
  const { t } = useTranslation();

  const suggestions = useMemo(() => [
    t('tasks.suggestionPresentation'),
    t('tasks.suggestionCompetitors'),
    t('tasks.suggestionFitbod'),
    t('tasks.suggestionTrip'),
    t('tasks.suggestionPomodoro'),
    t('tasks.suggestionMealPlan'),
  ], [t]);

  return (
    <div className="flex-1 flex flex-col items-center justify-center px-8 py-16">
      <div className="w-12 h-12 rounded-xl bg-accent/10 flex items-center justify-center mb-5">
        <Target size={24} className="text-accent" />
      </div>
      <h2 className="text-xl font-semibold text-text-primary mb-2">
        {t('tasks.emptyTitle')}
      </h2>
      <p className="text-sm text-text-secondary max-w-md text-center mb-8">
        {t('tasks.emptyDescription')}
      </p>
      <div className="grid grid-cols-2 gap-2 max-w-lg w-full">
        {suggestions.map((text) => (
          <button
            key={text}
            onClick={() => onSuggestionClick(text)}
            className="text-left text-sm px-3 py-2.5 rounded-lg bg-bg-secondary hover:bg-bg-tertiary text-text-secondary hover:text-text-primary transition-colors cursor-pointer border border-border-subtle"
          >
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}
