import clsx from 'clsx';

interface ToggleProps {
  checked: boolean;
  onChange: () => void;
}

export default function Toggle({ checked, onChange }: ToggleProps) {
  return (
    <button
      onClick={onChange}
      className={clsx(
        'relative w-8 h-[18px] rounded-full transition-colors duration-200 flex-shrink-0',
        checked ? 'bg-accent' : 'bg-bg-elevated border border-border-default',
      )}
    >
      <div
        className={clsx(
          'absolute top-0.5 w-3.5 h-3.5 rounded-full transition-transform duration-200',
          checked ? 'translate-x-[15px] bg-white' : 'translate-x-0.5 bg-text-tertiary',
        )}
      />
    </button>
  );
}
