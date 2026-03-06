import { describe, it, expect, vi } from 'vitest';
import { createTurnGovernor } from '../turn-governor';
import type { TierConfig } from '../model-tiers';

const testConfig: TierConfig = {
  maxTurns: 3,
  contextBudget: 4000,
  compressionThreshold: 2000,
  loopThreshold: 2,
  assistantTruncation: 150,
};

function createMockAgent() {
  const subscribers: Array<(e: any) => void> = [];
  return {
    subscribe: vi.fn((fn: (e: any) => void) => {
      subscribers.push(fn);
      return () => {
        const idx = subscribers.indexOf(fn);
        if (idx >= 0) subscribers.splice(idx, 1);
      };
    }),
    steer: vi.fn(),
    abort: vi.fn(),
    // Helper to emit events to all subscribers
    _emit(event: any) {
      for (const fn of subscribers) fn(event);
    },
  };
}

describe('createTurnGovernor', () => {
  it('steers on penultimate turn', () => {
    const agent = createMockAgent();
    createTurnGovernor(agent as any, testConfig);

    // Emit turn_end events (maxTurns=3, penultimate=2)
    agent._emit({ type: 'turn_end', message: {}, toolResults: [] });
    expect(agent.steer).not.toHaveBeenCalled();

    agent._emit({ type: 'turn_end', message: {}, toolResults: [] });
    expect(agent.steer).toHaveBeenCalledTimes(1);
    expect(agent.steer.mock.calls[0][0].content[0].text).toContain('LAST turn');
  });

  it('aborts at maxTurns', () => {
    const agent = createMockAgent();
    createTurnGovernor(agent as any, testConfig);

    agent._emit({ type: 'turn_end', message: {}, toolResults: [] });
    agent._emit({ type: 'turn_end', message: {}, toolResults: [] });
    agent._emit({ type: 'turn_end', message: {}, toolResults: [] });

    expect(agent.abort).toHaveBeenCalledTimes(1);
  });

  it('does not abort before maxTurns', () => {
    const agent = createMockAgent();
    createTurnGovernor(agent as any, testConfig);

    agent._emit({ type: 'turn_end', message: {}, toolResults: [] });
    agent._emit({ type: 'turn_end', message: {}, toolResults: [] });

    expect(agent.abort).not.toHaveBeenCalled();
  });

  it('detects loop from identical tool calls', () => {
    const agent = createMockAgent();
    createTurnGovernor(agent as any, testConfig);

    const toolEvent = {
      type: 'tool_execution_start',
      toolCallId: 'tc1',
      toolName: 'web_search',
      args: { query: 'test' },
    };

    agent._emit(toolEvent);
    expect(agent.steer).not.toHaveBeenCalled();

    // Second identical call — should trigger loop detection (loopThreshold=2)
    agent._emit(toolEvent);
    expect(agent.steer).toHaveBeenCalledTimes(1);
    expect(agent.steer.mock.calls[0][0].content[0].text).toContain('Loop detected');
  });

  it('does not trigger loop for different tool calls', () => {
    const agent = createMockAgent();
    createTurnGovernor(agent as any, testConfig);

    agent._emit({
      type: 'tool_execution_start',
      toolCallId: 'tc1',
      toolName: 'web_search',
      args: { query: 'test1' },
    });
    agent._emit({
      type: 'tool_execution_start',
      toolCallId: 'tc2',
      toolName: 'web_search',
      args: { query: 'test2' },
    });

    expect(agent.steer).not.toHaveBeenCalled();
  });

  it('returns cleanup function that unsubscribes', () => {
    const agent = createMockAgent();
    const cleanup = createTurnGovernor(agent as any, testConfig);

    expect(agent.subscribe).toHaveBeenCalledTimes(1);
    cleanup();

    // After cleanup, events should not trigger steer/abort
    agent._emit({ type: 'turn_end', message: {}, toolResults: [] });
    agent._emit({ type: 'turn_end', message: {}, toolResults: [] });
    agent._emit({ type: 'turn_end', message: {}, toolResults: [] });
    expect(agent.abort).not.toHaveBeenCalled();
  });
});
