/**
 * Global in-memory buffer + pub/sub for task terminal PTY data.
 *
 * Follows Turbo's terminalBuffer.ts pattern exactly:
 * - Plain Map buffer (not React state) so data never causes re-renders
 * - Subscriber notification so XTerm components get data directly
 * - Buffer captures data from the moment it starts flowing (before UI mounts)
 * - On mount, replay buffer then subscribe for live data — no gap, no dupes
 */

const MAX_BUFFER_SIZE = 512 * 1024; // 512 KB per run

const buffers = new Map<string, string>();
const listeners = new Map<string, Set<(data: string) => void>>();

export function appendTaskTerminalData(runId: string, data: string): void {
  const existing = buffers.get(runId) || '';
  let updated = existing + data;
  if (updated.length > MAX_BUFFER_SIZE) {
    updated = updated.slice(updated.length - MAX_BUFFER_SIZE);
  }
  buffers.set(runId, updated);

  // Notify direct subscribers (TaskConsoleView writes to xterm here)
  listeners.get(runId)?.forEach((cb) => cb(data));
}

export function getTaskTerminalBuffer(runId: string): string {
  return buffers.get(runId) || '';
}

export function clearTaskTerminalBuffer(runId: string): void {
  buffers.delete(runId);
}

/**
 * Subscribe to live PTY data for a specific run.
 * Returns an unsubscribe function.
 */
export function subscribeTaskTerminalData(
  runId: string,
  callback: (data: string) => void,
): () => void {
  if (!listeners.has(runId)) listeners.set(runId, new Set());
  listeners.get(runId)!.add(callback);
  return () => {
    listeners.get(runId)?.delete(callback);
    // Clean up empty sets
    if (listeners.get(runId)?.size === 0) listeners.delete(runId);
  };
}
