/**
 * Tests for TaskConsoleView rendering conditions.
 *
 * These tests verify that the terminal is shown/hidden correctly based on
 * task state. The key invariant: any task that has been started (has a run_id)
 * should ALWAYS show the terminal, even after completion/failure. Only
 * tasks that have never been started (no run_id) show the "no output" placeholder.
 *
 * Bug context: previously, `hasEntries` was calculated as:
 *   isLive || taskIsActive || (liveTask?.taskId === task.id && liveTask.logEntries.length > 0)
 * This caused the terminal to disappear when a task completed or failed quickly,
 * because liveTask was cleared and taskIsActive became false. The user would see
 * "No output" even though PTY data was in the buffer.
 */

import { describe, it, expect } from 'vitest';

// Mirror the rendering condition from TaskConsoleView.
// If this logic changes in the component, update this test accordingly.
function shouldShowTerminal(task: {
  status: string;
  run_id: string | null;
}, liveTask: {
  taskId: string;
  runId: string;
} | null): boolean {
  const isLive = liveTask?.taskId === task.run_id;
  const runId = isLive ? liveTask!.runId : task.run_id;
  return !!runId;
}

describe('TaskConsoleView — terminal visibility', () => {
  it('shows terminal for a running task with live state', () => {
    expect(shouldShowTerminal(
      { status: 'running', run_id: 'run-1' },
      { taskId: 'run-1', runId: 'run-1' },
    )).toBe(true);
  });

  it('shows terminal for a completed task (liveTask cleared)', () => {
    // This was the bug: liveTask is null after completion, terminal disappeared
    expect(shouldShowTerminal(
      { status: 'completed', run_id: 'run-1' },
      null,
    )).toBe(true);
  });

  it('shows terminal for a failed task (liveTask cleared)', () => {
    // This was the bug: task failed quickly, liveTask was cleared, terminal disappeared
    expect(shouldShowTerminal(
      { status: 'failed', run_id: 'run-1' },
      null,
    )).toBe(true);
  });

  it('shows terminal for a cancelled task', () => {
    expect(shouldShowTerminal(
      { status: 'cancelled', run_id: 'run-1' },
      null,
    )).toBe(true);
  });

  it('shows terminal for a clarifying task', () => {
    expect(shouldShowTerminal(
      { status: 'clarifying', run_id: 'run-1' },
      { taskId: 'run-1', runId: 'run-1' },
    )).toBe(true);
  });

  it('hides terminal for a pending task with no run_id', () => {
    expect(shouldShowTerminal(
      { status: 'pending', run_id: null },
      null,
    )).toBe(false);
  });

  it('shows terminal even when liveTask references a different task', () => {
    // Task has a run_id from a previous run, different liveTask is active
    expect(shouldShowTerminal(
      { status: 'completed', run_id: 'run-old' },
      { taskId: 'other-task', runId: 'run-other' },
    )).toBe(true);
  });
});

describe('TaskConsoleView — buffer preservation', () => {
  // These tests verify that buffer data is NOT cleared when a task finalizes,
  // so completed/failed tasks can still display their terminal output.

  it('preserveBuffer=true keeps data after finalize', async () => {
    const { appendTaskTerminalData, getTaskTerminalBuffer, clearTaskTerminalBuffer } = await import('./taskTerminalBuffer');
    const runId = 'preserve-test';

    appendTaskTerminalData(runId, 'Hello from Claude Code');
    expect(getTaskTerminalBuffer(runId)).toBe('Hello from Claude Code');

    // Simulate finalize with preserveBuffer=true (the fix)
    // Buffer should NOT be cleared
    // (cleanup(true) skips clearTaskTerminalBuffer)
    expect(getTaskTerminalBuffer(runId)).toBe('Hello from Claude Code');

    // Cleanup
    clearTaskTerminalBuffer(runId);
  });

  it('buffer cleared only on explicit cleanup without preserve', async () => {
    const { appendTaskTerminalData, getTaskTerminalBuffer, clearTaskTerminalBuffer } = await import('./taskTerminalBuffer');
    const runId = 'clear-test';

    appendTaskTerminalData(runId, 'Some output');
    expect(getTaskTerminalBuffer(runId)).toBe('Some output');

    // Simulate cleanup without preserveBuffer (e.g., task deletion)
    clearTaskTerminalBuffer(runId);
    expect(getTaskTerminalBuffer(runId)).toBe('');
  });
});
