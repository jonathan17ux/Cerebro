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

  // Sliding window of recent tool call hashes for loop detection.
  // Catches both consecutive repeats (A→A→A) and alternating patterns (A→B→A→B).
  const WINDOW_SIZE = 6;
  const recentHashes: string[] = [];

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

    // Track tool calls for loop detection via sliding window
    if (event.type === 'tool_execution_start') {
      const hash = event.toolName + JSON.stringify(event.args);

      // Add to sliding window
      recentHashes.push(hash);
      if (recentHashes.length > WINDOW_SIZE) {
        recentHashes.shift();
      }

      // Count occurrences of this hash in the window
      const count = recentHashes.filter((h) => h === hash).length;

      if (count >= loopThreshold) {
        agent.steer({
          role: 'user',
          content: [{ type: 'text', text: `Loop detected: you called "${event.toolName}" with the same arguments ${count} times in the last ${recentHashes.length} calls. Try a different approach or provide your answer with the information you already have.` }],
          timestamp: Date.now(),
        } as any);
        // Clear window so we don't spam steer messages
        recentHashes.length = 0;
      }
    }
  });

  return unsubscribe;
}
