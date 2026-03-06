/**
 * Turn control & loop detection.
 *
 * Subscribes to agent events via agent.subscribe():
 * - Counts turn_end events toward maxTurns
 * - On penultimate turn: steer() with "last turn, provide final answer"
 * - On maxTurns: abort()
 * - Tracks tool call hashes for loop detection
 * - On N identical calls: steer() with "loop detected"
 */

import type { Agent, AgentEvent } from '@mariozechner/pi-agent-core';
import type { TierConfig } from './model-tiers';

/**
 * Attach turn governor to an agent. Returns cleanup function.
 */
export function createTurnGovernor(agent: Agent, tierConfig: TierConfig): () => void {
  const { maxTurns, loopThreshold } = tierConfig;
  let turnCount = 0;

  // Track tool call patterns for loop detection
  // Key = toolName + stringified args, Value = consecutive count
  const toolCallCounts = new Map<string, number>();
  let lastToolCallHash = '';

  const unsubscribe = agent.subscribe((event: AgentEvent) => {
    if (event.type === 'turn_end') {
      turnCount++;

      // Penultimate turn warning
      if (turnCount === maxTurns - 1) {
        agent.steer({
          role: 'user',
          content: [{ type: 'text', text: 'You are on your LAST turn. Provide your final answer now. If you delegated to an expert, synthesize their response. Do not start new tool calls.' }],
          timestamp: Date.now(),
        } as any);
      }

      // Hard stop at maxTurns
      if (turnCount >= maxTurns) {
        agent.abort();
      }
    }

    // Track tool calls for loop detection
    if (event.type === 'tool_execution_start') {
      const hash = event.toolName + JSON.stringify(event.args);

      if (hash === lastToolCallHash) {
        const count = (toolCallCounts.get(hash) || 1) + 1;
        toolCallCounts.set(hash, count);

        if (count >= loopThreshold) {
          agent.steer({
            role: 'user',
            content: [{ type: 'text', text: `Loop detected: you called "${event.toolName}" with the same arguments ${count} times. Try a different approach or provide your answer with the information you already have.` }],
            timestamp: Date.now(),
          } as any);
          // Reset count so we don't spam steer messages
          toolCallCounts.set(hash, 0);
        }
      } else {
        lastToolCallHash = hash;
        toolCallCounts.set(hash, 1);
      }
    }
  });

  return unsubscribe;
}
