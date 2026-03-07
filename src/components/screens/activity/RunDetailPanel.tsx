import { useState, useEffect } from 'react';
import { X, Loader2 } from 'lucide-react';
import clsx from 'clsx';
import type { RunRecord, EventRecord, RunListResponse } from './types';
import { formatDuration, formatTimestamp, STATUS_CONFIG, RUN_TYPE_LABELS, TRIGGER_LABELS } from './helpers';
import StatusDot from './StatusDot';
import StepTimeline from './StepTimeline';
import EventLog from './EventLog';

// ── Section helper ──────────────────────────────────────────────

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="text-[10px] font-semibold uppercase tracking-wider text-accent mb-2.5">
        {label}
      </h4>
      {children}
    </div>
  );
}

// ── Tabs ────────────────────────────────────────────────────────

type Tab = 'steps' | 'events' | 'children';

// ── Component ──────────────────────────────────────────────────

interface RunDetailPanelProps {
  runId: string;
  routineName?: string;
  onClose: () => void;
  onSelectRun?: (runId: string) => void;
}

export default function RunDetailPanel({ runId, routineName, onClose, onSelectRun }: RunDetailPanelProps) {
  const [run, setRun] = useState<RunRecord | null>(null);
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [children, setChildren] = useState<RunRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<Tab>('steps');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setActiveTab('steps');

    Promise.all([
      window.cerebro.invoke<RunRecord>({ method: 'GET', path: `/engine/runs/${runId}` }),
      window.cerebro.invoke<EventRecord[]>({ method: 'GET', path: `/engine/runs/${runId}/events?limit=500` }),
      window.cerebro.invoke<RunListResponse>({ method: 'GET', path: `/engine/runs/${runId}/children` }),
    ]).then(([runRes, eventsRes, childrenRes]) => {
      if (cancelled) return;
      if (runRes.ok) setRun(runRes.data);
      if (eventsRes.ok) setEvents(eventsRes.data);
      if (childrenRes.ok) setChildren(childrenRes.data.runs);
      setLoading(false);
    });

    return () => { cancelled = true; };
  }, [runId]);

  const cfg = run ? (STATUS_CONFIG[run.status] ?? STATUS_CONFIG.created) : STATUS_CONFIG.created;
  const displayName = routineName ?? (run ? (RUN_TYPE_LABELS[run.run_type] ?? run.run_type) : 'Run');
  const hasChildren = children.length > 0;

  const tabs: { key: Tab; label: string; show: boolean }[] = [
    { key: 'steps', label: 'Steps', show: true },
    { key: 'events', label: 'Events', show: true },
    { key: 'children', label: 'Children', show: hasChildren },
  ];

  return (
    <div className="absolute top-0 right-0 bottom-0 w-[380px] bg-bg-surface border-l border-border-subtle animate-slide-in-right z-10 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-border-subtle flex-shrink-0">
        <h3 className="text-sm font-semibold text-text-primary tracking-wide">
          Run Details
        </h3>
        <button
          onClick={onClose}
          className="p-1 rounded-md text-text-tertiary hover:text-text-secondary hover:bg-bg-hover transition-colors"
        >
          <X size={16} />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto scrollbar-thin px-5 py-5 space-y-6">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 size={20} className="text-accent animate-spin" />
          </div>
        ) : run ? (
          <>
            {/* Run info */}
            <Section label="RUN">
              <div className="space-y-2.5">
                <div className="text-sm font-medium text-text-primary">{displayName}</div>
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-1.5">
                    <StatusDot status={run.status} />
                    <span className={clsx('text-xs font-medium', cfg.text)}>{cfg.label}</span>
                  </div>
                  <span className="text-xs tabular-nums text-text-secondary">
                    {formatDuration(run.duration_ms)}
                  </span>
                  <span className="text-xs text-text-tertiary">
                    {TRIGGER_LABELS[run.trigger] ?? run.trigger}
                  </span>
                </div>
                <div className="space-y-1 text-[11px] text-text-tertiary">
                  <div>Started: <span className="text-text-secondary">{formatTimestamp(run.started_at)}</span></div>
                  <div>Finished: <span className="text-text-secondary">{formatTimestamp(run.completed_at)}</span></div>
                </div>
                {run.status === 'failed' && run.error && (
                  <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-2.5">
                    <p className="text-[11px] text-red-400 leading-relaxed">{run.error}</p>
                  </div>
                )}
              </div>
            </Section>

            {/* Tab switcher */}
            <div className="border-b border-border-subtle flex gap-4">
              {tabs.filter(t => t.show).map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className={clsx(
                    'pb-2 text-xs font-medium transition-colors -mb-px border-b-2',
                    activeTab === tab.key
                      ? 'border-accent text-accent'
                      : 'border-transparent text-text-tertiary hover:text-text-secondary',
                  )}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Tab content */}
            {activeTab === 'steps' && (
              <StepTimeline steps={run.steps ?? []} />
            )}
            {activeTab === 'events' && (
              <EventLog events={events} />
            )}
            {activeTab === 'children' && (
              <div className="space-y-1.5">
                {children.map((child) => {
                  const childCfg = STATUS_CONFIG[child.status] ?? STATUS_CONFIG.created;
                  return (
                    <button
                      key={child.id}
                      onClick={() => onSelectRun?.(child.id)}
                      className="w-full flex items-center gap-2.5 bg-bg-base rounded-lg px-3 py-2 border border-border-subtle hover:border-border-default hover:bg-bg-hover transition-colors text-left"
                    >
                      <StatusDot status={child.status} />
                      <div className="flex-1 min-w-0">
                        <span className="text-xs text-text-primary truncate block">
                          {RUN_TYPE_LABELS[child.run_type] ?? child.run_type}
                        </span>
                      </div>
                      <span className="text-[10px] tabular-nums text-text-tertiary">
                        {formatDuration(child.duration_ms)}
                      </span>
                      <span className={clsx('text-[10px] font-medium', childCfg.text)}>
                        {childCfg.label}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </>
        ) : (
          <p className="text-xs text-text-tertiary text-center py-8">Run not found.</p>
        )}
      </div>

      {/* Footer */}
      <div className="px-5 py-3 border-t border-border-subtle flex-shrink-0">
        <code className="text-[10px] font-mono text-text-tertiary">
          {runId.length > 24 ? `${runId.slice(0, 24)}\u2026` : runId}
        </code>
      </div>
    </div>
  );
}
