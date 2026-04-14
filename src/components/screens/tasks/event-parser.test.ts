import { describe, it, expect } from 'vitest';
import { parseTaskEvents, type RawTaskEvent } from './event-parser';

// Helper to build a RawTaskEvent
function raw(seq: number, kind: string, payload: Record<string, unknown>): RawTaskEvent {
  return { seq, kind, payload_json: JSON.stringify(payload) };
}

// ── text_delta ──────────────────────────────────────────────────────

describe('parseTaskEvents — text_delta', () => {
  it('parses a text_delta event', () => {
    const entries = parseTaskEvents([raw(1, 'text_delta', { delta: 'Hello' })]);
    expect(entries).toEqual([{ kind: 'text_delta', text: 'Hello', phaseId: null }]);
  });

  it('includes phaseId when present', () => {
    const entries = parseTaskEvents([raw(1, 'text_delta', { delta: 'Hi', phaseId: 'p1' })]);
    expect(entries).toEqual([{ kind: 'text_delta', text: 'Hi', phaseId: 'p1' }]);
  });

  it('defaults delta to empty string when missing', () => {
    const entries = parseTaskEvents([raw(1, 'text_delta', {})]);
    expect(entries).toEqual([{ kind: 'text_delta', text: '', phaseId: null }]);
  });
});

// ── tool_start ──────────────────────────────────────────────────────

describe('parseTaskEvents — tool_start', () => {
  it('parses a tool_start event', () => {
    const entries = parseTaskEvents([
      raw(1, 'tool_start', { toolCallId: 'tc-1', toolName: 'readFile', args: { path: '/tmp/a.txt' } }),
    ]);
    expect(entries).toEqual([
      { kind: 'tool_start', toolCallId: 'tc-1', toolName: 'readFile', args: { path: '/tmp/a.txt' } },
    ]);
  });
});

// ── tool_end ────────────────────────────────────────────────────────

describe('parseTaskEvents — tool_end', () => {
  it('parses a tool_end event', () => {
    const entries = parseTaskEvents([
      raw(1, 'tool_end', { toolCallId: 'tc-1', toolName: 'readFile', result: 'file contents', isError: false }),
    ]);
    expect(entries).toEqual([
      { kind: 'tool_end', toolCallId: 'tc-1', toolName: 'readFile', result: 'file contents', isError: false },
    ]);
  });

  it('parses a tool_end with isError true', () => {
    const entries = parseTaskEvents([
      raw(1, 'tool_end', { toolCallId: 'tc-2', toolName: 'exec', result: 'ENOENT', isError: true }),
    ]);
    expect(entries[0]).toMatchObject({ kind: 'tool_end', isError: true, result: 'ENOENT' });
  });
});

// ── phase_start / phase_end ─────────────────────────────────────────

describe('parseTaskEvents — phase lifecycle', () => {
  it('parses a phase_start event', () => {
    const entries = parseTaskEvents([raw(1, 'phase_start', { phaseId: 'p1', name: 'Research' })]);
    expect(entries).toEqual([{ kind: 'phase_start', phaseId: 'p1', name: 'Research' }]);
  });

  it('defaults phaseId and name to empty string when missing', () => {
    const entries = parseTaskEvents([raw(1, 'phase_start', {})]);
    expect(entries).toEqual([{ kind: 'phase_start', phaseId: '', name: '' }]);
  });

  it('parses a phase_end event', () => {
    const entries = parseTaskEvents([raw(1, 'phase_end', { phaseId: 'p1' })]);
    expect(entries).toEqual([{ kind: 'phase_end', phaseId: 'p1' }]);
  });

  it('defaults phase_end phaseId to empty string when missing', () => {
    const entries = parseTaskEvents([raw(1, 'phase_end', {})]);
    expect(entries).toEqual([{ kind: 'phase_end', phaseId: '' }]);
  });
});

// ── error ───────────────────────────────────────────────────────────

describe('parseTaskEvents — error', () => {
  it('parses an error event', () => {
    const entries = parseTaskEvents([raw(1, 'error', { error: 'Something broke' })]);
    expect(entries).toEqual([{ kind: 'error', message: 'Something broke' }]);
  });

  it('defaults to "Unknown error" when error field is missing', () => {
    const entries = parseTaskEvents([raw(1, 'error', {})]);
    expect(entries).toEqual([{ kind: 'error', message: 'Unknown error' }]);
  });
});

// ── system ──────────────────────────────────────────────────────────

describe('parseTaskEvents — system', () => {
  it('parses a system event', () => {
    const entries = parseTaskEvents([raw(1, 'system', { message: 'Task started' })]);
    expect(entries).toEqual([{ kind: 'system', message: 'Task started' }]);
  });

  it('defaults to "system event" when message field is missing', () => {
    const entries = parseTaskEvents([raw(1, 'system', {})]);
    expect(entries).toEqual([{ kind: 'system', message: 'system event' }]);
  });
});

// ── Unknown kinds ───────────────────────────────────────────────────

describe('parseTaskEvents — unknown kinds', () => {
  it('skips events with unrecognized kind', () => {
    const entries = parseTaskEvents([
      raw(1, 'text_delta', { delta: 'keep' }),
      raw(2, 'unknown_kind', { foo: 'bar' }),
      raw(3, 'error', { error: 'also keep' }),
    ]);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ kind: 'text_delta' });
    expect(entries[1]).toMatchObject({ kind: 'error' });
  });
});

// ── Malformed JSON ──────────────────────────────────────────────────

describe('parseTaskEvents — malformed payload', () => {
  it('skips events with invalid JSON in payload_json', () => {
    const events: RawTaskEvent[] = [
      { seq: 1, kind: 'text_delta', payload_json: '{invalid json}' },
      raw(2, 'text_delta', { delta: 'valid' }),
    ];
    const entries = parseTaskEvents(events);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ kind: 'text_delta', text: 'valid' });
  });

  it('returns empty array when all events are malformed', () => {
    const events: RawTaskEvent[] = [
      { seq: 1, kind: 'text_delta', payload_json: 'not json' },
      { seq: 2, kind: 'error', payload_json: '' },
    ];
    const entries = parseTaskEvents(events);
    expect(entries).toEqual([]);
  });
});

// ── Multiple events (ordering) ──────────────────────────────────────

describe('parseTaskEvents — ordering', () => {
  it('preserves input order across mixed event kinds', () => {
    const events = [
      raw(1, 'system', { message: 'Starting' }),
      raw(2, 'phase_start', { phaseId: 'p1', name: 'Setup' }),
      raw(3, 'text_delta', { delta: 'Installing deps...', phaseId: 'p1' }),
      raw(4, 'tool_start', { toolCallId: 'tc-1', toolName: 'exec', args: { cmd: 'npm i' } }),
      raw(5, 'tool_end', { toolCallId: 'tc-1', toolName: 'exec', result: 'ok', isError: false }),
      raw(6, 'phase_end', { phaseId: 'p1' }),
    ];
    const entries = parseTaskEvents(events);
    const kinds = entries.map((e) => e.kind);
    expect(kinds).toEqual(['system', 'phase_start', 'text_delta', 'tool_start', 'tool_end', 'phase_end']);
  });

  it('handles empty input array', () => {
    expect(parseTaskEvents([])).toEqual([]);
  });
});
