import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  appendTaskTerminalData,
  getTaskTerminalBuffer,
  clearTaskTerminalBuffer,
  subscribeTaskTerminalData,
} from './taskTerminalBuffer';

// The module uses module-level Maps, so we need to clean up between tests
// by clearing every runId we touch.
const usedRunIds: string[] = [];
function trackId(id: string): string {
  usedRunIds.push(id);
  return id;
}

beforeEach(() => {
  for (const id of usedRunIds) {
    clearTaskTerminalBuffer(id);
  }
  usedRunIds.length = 0;
});

// ── Basic append + get ──────────────────────────────────────────────

describe('appendTaskTerminalData / getTaskTerminalBuffer', () => {
  it('returns accumulated data after multiple appends', () => {
    const id = trackId('run-1');
    appendTaskTerminalData(id, 'hello ');
    appendTaskTerminalData(id, 'world');
    expect(getTaskTerminalBuffer(id)).toBe('hello world');
  });

  it('keeps data for multiple runIds separate', () => {
    const a = trackId('run-a');
    const b = trackId('run-b');
    appendTaskTerminalData(a, 'alpha');
    appendTaskTerminalData(b, 'beta');
    expect(getTaskTerminalBuffer(a)).toBe('alpha');
    expect(getTaskTerminalBuffer(b)).toBe('beta');
  });

  it('returns empty string for unknown runId', () => {
    expect(getTaskTerminalBuffer('nonexistent')).toBe('');
  });
});

// ── clear ───────────────────────────────────────────────────────────

describe('clearTaskTerminalBuffer', () => {
  it('removes buffer for the given runId', () => {
    const id = trackId('run-clear');
    appendTaskTerminalData(id, 'data');
    clearTaskTerminalBuffer(id);
    expect(getTaskTerminalBuffer(id)).toBe('');
  });

  it('does not affect other runIds', () => {
    const a = trackId('run-keep');
    const b = trackId('run-remove');
    appendTaskTerminalData(a, 'keep me');
    appendTaskTerminalData(b, 'remove me');
    clearTaskTerminalBuffer(b);
    expect(getTaskTerminalBuffer(a)).toBe('keep me');
    expect(getTaskTerminalBuffer(b)).toBe('');
  });
});

// ── subscribe / unsubscribe ─────────────────────────────────────────

describe('subscribeTaskTerminalData', () => {
  it('subscriber receives new data on append', () => {
    const id = trackId('run-sub-1');
    const received: string[] = [];
    const unsub = subscribeTaskTerminalData(id, (data) => received.push(data));

    appendTaskTerminalData(id, 'chunk1');
    appendTaskTerminalData(id, 'chunk2');

    expect(received).toEqual(['chunk1', 'chunk2']);
    unsub();
  });

  it('subscriber receives only the new chunk, not the full buffer', () => {
    const id = trackId('run-sub-chunk');
    appendTaskTerminalData(id, 'existing');

    const received: string[] = [];
    const unsub = subscribeTaskTerminalData(id, (data) => received.push(data));

    appendTaskTerminalData(id, '-new');
    expect(received).toEqual(['-new']);
    // The full buffer has both, but the callback only got the new chunk
    expect(getTaskTerminalBuffer(id)).toBe('existing-new');
    unsub();
  });

  it('multiple subscribers all receive data', () => {
    const id = trackId('run-multi-sub');
    const received1: string[] = [];
    const received2: string[] = [];

    const unsub1 = subscribeTaskTerminalData(id, (d) => received1.push(d));
    const unsub2 = subscribeTaskTerminalData(id, (d) => received2.push(d));

    appendTaskTerminalData(id, 'broadcast');

    expect(received1).toEqual(['broadcast']);
    expect(received2).toEqual(['broadcast']);
    unsub1();
    unsub2();
  });

  it('unsubscribe stops notifications', () => {
    const id = trackId('run-unsub');
    const cb = vi.fn();
    const unsub = subscribeTaskTerminalData(id, cb);

    appendTaskTerminalData(id, 'before');
    unsub();
    appendTaskTerminalData(id, 'after');

    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith('before');
  });

  it('listener set is removed after last unsubscribe', () => {
    const id = trackId('run-cleanup');
    const unsub1 = subscribeTaskTerminalData(id, () => {});
    const unsub2 = subscribeTaskTerminalData(id, () => {});

    unsub1();
    // After removing one, appending should still work without error
    appendTaskTerminalData(id, 'still ok');

    unsub2();
    // After removing all, appending should still work (no listeners, no crash)
    appendTaskTerminalData(id, 'also ok');
    expect(getTaskTerminalBuffer(id)).toBe('still okalso ok');
  });
});

// ── Buffer truncation (MAX_BUFFER_SIZE = 512 KB) ────────────────────

describe('buffer truncation', () => {
  const MAX_BUFFER_SIZE = 512 * 1024;

  it('truncates at MAX_BUFFER_SIZE', () => {
    const id = trackId('run-trunc');
    // Write more than 512KB
    const bigChunk = 'x'.repeat(MAX_BUFFER_SIZE + 100);
    appendTaskTerminalData(id, bigChunk);
    expect(getTaskTerminalBuffer(id).length).toBe(MAX_BUFFER_SIZE);
  });

  it('preserves the most recent data after truncation', () => {
    const id = trackId('run-trunc-recent');
    // Fill buffer to capacity with 'a'
    appendTaskTerminalData(id, 'a'.repeat(MAX_BUFFER_SIZE));
    // Append a distinctive tail
    const tail = 'RECENT_DATA';
    appendTaskTerminalData(id, tail);

    const buf = getTaskTerminalBuffer(id);
    expect(buf.length).toBe(MAX_BUFFER_SIZE);
    expect(buf.endsWith(tail)).toBe(true);
    // The oldest 'a' chars were dropped
    expect(buf.startsWith('a')).toBe(true);
  });

  it('subscriber still fires after truncation', () => {
    const id = trackId('run-trunc-sub');
    const received: string[] = [];
    const unsub = subscribeTaskTerminalData(id, (d) => received.push(d));

    // Fill past limit
    appendTaskTerminalData(id, 'x'.repeat(MAX_BUFFER_SIZE + 50));
    // Subscriber should still have been called with the original data arg
    expect(received).toHaveLength(1);
    expect(received[0].length).toBe(MAX_BUFFER_SIZE + 50);

    // Append more
    appendTaskTerminalData(id, 'more');
    expect(received).toHaveLength(2);
    expect(received[1]).toBe('more');

    unsub();
  });
});
