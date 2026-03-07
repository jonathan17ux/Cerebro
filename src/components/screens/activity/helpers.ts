// ── Activity screen helpers ─────────────────────────────────────

export function timeAgo(dateStr: string | null): string {
  if (!dateStr) return 'Never';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export function formatDuration(ms: number | null): string {
  if (ms == null) return '\u2014';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${m}m ${s}s`;
}

export function formatTimestamp(dateStr: string | null): string {
  if (!dateStr) return '\u2014';
  const d = new Date(dateStr);
  const now = new Date();
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

  const isToday =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (isToday) return `Today, ${time}`;

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday =
    d.getFullYear() === yesterday.getFullYear() &&
    d.getMonth() === yesterday.getMonth() &&
    d.getDate() === yesterday.getDate();
  if (isYesterday) return `Yesterday, ${time}`;

  const month = d.toLocaleString([], { month: 'short' });
  return `${month} ${d.getDate()}, ${time}`;
}

export function formatEventTime(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}

// ── Status config ────────────────────────────────────────────────

export interface StatusStyle {
  dot: string;
  text: string;
  label: string;
  glow?: boolean;
}

export const STATUS_CONFIG: Record<string, StatusStyle> = {
  running:   { dot: 'bg-yellow-500', text: 'text-yellow-500', label: 'Running', glow: true },
  paused:    { dot: 'bg-amber-400',  text: 'text-amber-400',  label: 'Paused',  glow: true },
  completed: { dot: 'bg-green-500',  text: 'text-green-500',  label: 'Completed' },
  failed:    { dot: 'bg-red-500',    text: 'text-red-500',    label: 'Failed' },
  cancelled: { dot: 'bg-zinc-500',   text: 'text-text-tertiary', label: 'Cancelled' },
  created:   { dot: 'bg-zinc-500',   text: 'text-text-tertiary', label: 'Created' },
};

export const RUN_TYPE_LABELS: Record<string, string> = {
  routine: 'Routine',
  preview: 'Preview',
  ad_hoc: 'Ad-Hoc',
  orchestration: 'Orchestration',
};

export const TRIGGER_LABELS: Record<string, string> = {
  manual: 'Manual',
  scheduled: 'Scheduled',
  chat: 'Chat',
  webhook: 'Webhook',
};
