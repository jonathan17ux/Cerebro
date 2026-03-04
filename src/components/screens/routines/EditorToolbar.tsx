import { useState, useRef, useEffect } from 'react';
import {
  ArrowLeft,
  Save,
  Play,
  LayoutGrid,
  Power,
  Hand,
  Clock,
  Webhook,
} from 'lucide-react';
import clsx from 'clsx';
import type { Routine, TriggerType } from '../../../types/routines';
import { useRoutines } from '../../../context/RoutineContext';
import Toggle from '../../ui/Toggle';

// ── Helpers ────────────────────────────────────────────────────

const TRIGGER_OPTIONS: { value: TriggerType; label: string; icon: typeof Hand }[] = [
  { value: 'manual', label: 'Manual', icon: Hand },
  { value: 'cron', label: 'Scheduled', icon: Clock },
  { value: 'webhook', label: 'Webhook', icon: Webhook },
];

// ── Component ──────────────────────────────────────────────────

interface EditorToolbarProps {
  routine: Routine;
  isDirty: boolean;
  hasNodes: boolean;
  onSave: () => Promise<void>;
  onAutoLayout: () => void;
}

export default function EditorToolbar({
  routine,
  isDirty,
  hasNodes,
  onSave,
  onAutoLayout,
}: EditorToolbarProps) {
  const { setEditingRoutineId, updateRoutine, toggleEnabled, runRoutine } =
    useRoutines();

  const [name, setName] = useState(routine.name);
  const [isSaving, setIsSaving] = useState(false);
  const [showTriggerMenu, setShowTriggerMenu] = useState(false);
  const triggerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setName(routine.name);
  }, [routine.name]);

  // Close trigger menu on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (triggerRef.current && !triggerRef.current.contains(e.target as Node)) {
        setShowTriggerMenu(false);
      }
    };
    if (showTriggerMenu) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showTriggerMenu]);

  const handleNameBlur = () => {
    const trimmed = name.trim();
    if (trimmed && trimmed !== routine.name) {
      updateRoutine(routine.id, { name: trimmed });
    } else {
      setName(routine.name);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await onSave();
    } finally {
      setIsSaving(false);
    }
  };

  const handleTriggerChange = (value: TriggerType) => {
    updateRoutine(routine.id, { trigger_type: value });
    setShowTriggerMenu(false);
  };

  const currentTrigger =
    TRIGGER_OPTIONS.find((t) => t.value === routine.triggerType) ?? TRIGGER_OPTIONS[0];
  const TriggerIcon = currentTrigger.icon;

  return (
    <div className="flex items-center gap-3 px-4 py-2.5 bg-bg-surface border-b border-border-subtle flex-shrink-0 z-20">
      {/* Left: Back + Name */}
      <button
        onClick={() => setEditingRoutineId(null)}
        className="p-1.5 rounded-md text-text-tertiary hover:text-text-secondary hover:bg-bg-hover transition-colors"
      >
        <ArrowLeft size={16} />
      </button>

      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={handleNameBlur}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        className="text-sm font-medium text-text-primary bg-transparent border-none outline-none hover:bg-bg-hover focus:bg-bg-elevated rounded px-2 py-1 transition-colors min-w-[120px] max-w-[280px]"
      />

      {/* Center: Trigger pill */}
      <div className="relative" ref={triggerRef}>
        <button
          onClick={() => setShowTriggerMenu((prev) => !prev)}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium bg-bg-elevated text-text-secondary border border-border-subtle hover:border-border-default transition-colors"
        >
          <TriggerIcon size={11} />
          {currentTrigger.label}
        </button>

        {showTriggerMenu && (
          <div className="absolute top-full left-0 mt-1 bg-bg-elevated border border-border-subtle rounded-lg shadow-lg py-1 min-w-[140px] z-50">
            {TRIGGER_OPTIONS.map((opt) => {
              const OptIcon = opt.icon;
              return (
                <button
                  key={opt.value}
                  onClick={() => handleTriggerChange(opt.value)}
                  className={clsx(
                    'flex items-center gap-2 w-full px-3 py-1.5 text-xs transition-colors',
                    opt.value === routine.triggerType
                      ? 'text-accent bg-accent/10'
                      : 'text-text-secondary hover:bg-bg-hover',
                  )}
                >
                  <OptIcon size={12} />
                  {opt.label}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="flex-1" />

      {/* Right: Actions */}
      <div className="flex items-center gap-2">
        <button
          onClick={onAutoLayout}
          disabled={!hasNodes}
          className="p-1.5 rounded-md text-text-tertiary hover:text-text-secondary hover:bg-bg-hover disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          title="Auto-layout"
        >
          <LayoutGrid size={15} />
        </button>

        <div className="flex items-center gap-1.5">
          <Power
            size={12}
            className={clsx(
              routine.isEnabled ? 'text-green-400' : 'text-text-tertiary',
            )}
          />
          <Toggle
            checked={routine.isEnabled}
            onChange={() => toggleEnabled(routine)}
          />
        </div>

        <button
          onClick={handleSave}
          disabled={!isDirty || isSaving}
          className={clsx(
            'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
            isDirty
              ? 'bg-accent text-bg-base hover:bg-accent-hover'
              : 'bg-bg-elevated text-text-tertiary cursor-not-allowed',
          )}
        >
          <Save size={13} />
          {isSaving ? 'Saving...' : 'Save'}
        </button>

        <button
          onClick={() => runRoutine(routine.id)}
          disabled={!routine.isEnabled || !routine.dagJson || isDirty}
          title={isDirty ? 'Save changes before running' : undefined}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-bg-elevated text-text-secondary hover:text-text-primary hover:bg-bg-hover disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          <Play size={13} />
          Run
        </button>
      </div>
    </div>
  );
}
