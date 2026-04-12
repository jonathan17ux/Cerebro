import { Target } from 'lucide-react';

const SUGGESTIONS = [
  'Build a presentation about AI trends in 2026',
  'Research competitors in HR software and write a positioning brief',
  'Design a Fitbod clone — product spec and phased build plan',
  'Plan a 10-day trip to Kyoto for spring 2026',
  'Build a pomodoro timer web app with dark mode',
  'Build a 7-day meal plan with shopping list',
];

interface TaskEmptyStateProps {
  onSuggestionClick: (text: string) => void;
}

export default function TaskEmptyState({ onSuggestionClick }: TaskEmptyStateProps) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center px-8 py-16">
      <div className="w-12 h-12 rounded-xl bg-accent/10 flex items-center justify-center mb-5">
        <Target size={24} className="text-accent" />
      </div>
      <h2 className="text-xl font-semibold text-text-primary mb-2">
        Give Cerebro a goal. It'll run the whole thing.
      </h2>
      <p className="text-sm text-text-secondary max-w-md text-center mb-8">
        Describe what you want — a spec, an app, a research brief — and Cerebro
        will decompose the goal, hire experts, execute each phase, and deliver the result.
      </p>
      <div className="grid grid-cols-2 gap-2 max-w-lg w-full">
        {SUGGESTIONS.map((text) => (
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
