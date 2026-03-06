/**
 * Context window management — prunes messages to fit within token budget.
 *
 * Implements the `transformContext` signature expected by pi-agent-core:
 *   (messages: AgentMessage[], signal?: AbortSignal) => Promise<AgentMessage[]>
 */

import type { TierConfig } from './model-tiers';

/** Rough token estimate: ~4 chars per token. */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Estimate total tokens across all messages. */
function estimateMessageTokens(messages: unknown[]): number {
  let total = 0;
  for (const msg of messages) {
    total += estimateTokens(serializeMessage(msg));
  }
  return total;
}

/** Serialize a message to a string for token counting. */
function serializeMessage(msg: unknown): string {
  if (!msg || typeof msg !== 'object') return '';
  const m = msg as Record<string, unknown>;

  if (typeof m.content === 'string') return m.content;
  if (Array.isArray(m.content)) {
    return m.content
      .map((c: Record<string, unknown>) => {
        if (c.type === 'text') return (c.text as string) || '';
        if (c.type === 'toolCall') return JSON.stringify(c.arguments || {});
        return '';
      })
      .join('\n');
  }
  return JSON.stringify(m);
}

/** Check if a message is a tool result. */
function isToolResult(msg: unknown): boolean {
  return !!msg && typeof msg === 'object' && (msg as Record<string, unknown>).role === 'toolResult';
}

/** Check if a message is an assistant message. */
function isAssistant(msg: unknown): boolean {
  return !!msg && typeof msg === 'object' && (msg as Record<string, unknown>).role === 'assistant';
}

/** Check if a message is a user message. */
function isUser(msg: unknown): boolean {
  return !!msg && typeof msg === 'object' && (msg as Record<string, unknown>).role === 'user';
}

/**
 * Create a transformContext function bound to a tier config.
 *
 * Pruning strategy (preserves last 2 complete turns + first user message):
 *  1. Replace old tool results with one-line summaries
 *  2. Truncate old assistant messages to 200 chars
 *  3. Drop oldest middle messages as last resort
 */
export function createContextTransform(tierConfig: TierConfig) {
  return async function transformContext(messages: unknown[]): Promise<unknown[]> {
    if (estimateMessageTokens(messages) <= tierConfig.contextBudget) {
      return messages;
    }

    const result = [...messages];

    // Find boundary: preserve first user message + last 2 complete turns
    // A "turn" = user message + assistant response (+ any tool results in between)
    const preserveFromEnd = countTailMessages(result, 2);
    const preserveStart = findFirstUserIndex(result);
    const safeStart = preserveStart >= 0 ? preserveStart + 1 : 0;
    const safeEnd = result.length - preserveFromEnd;

    // Phase 1: Replace old tool results with summaries
    for (let i = safeStart; i < safeEnd; i++) {
      if (isToolResult(result[i])) {
        const original = serializeMessage(result[i]);
        if (original.length > 100) {
          const msg = result[i] as Record<string, unknown>;
          const summary = original.slice(0, 80) + '... (truncated)';
          result[i] = {
            role: 'toolResult',
            toolCallId: msg.toolCallId,
            toolName: msg.toolName,
            content: [{ type: 'text', text: `[Result summary: ${summary}]` }],
            isError: msg.isError ?? false,
            timestamp: msg.timestamp,
          };
        }
      }
    }

    if (estimateMessageTokens(result) <= tierConfig.contextBudget) {
      return result;
    }

    // Phase 2: Truncate old assistant messages
    for (let i = safeStart; i < safeEnd; i++) {
      if (isAssistant(result[i])) {
        const text = serializeMessage(result[i]);
        if (text.length > 200) {
          const msg = result[i] as Record<string, unknown>;
          result[i] = {
            ...msg,
            content: [{ type: 'text', text: text.slice(0, 200) + '... (truncated)' }],
          };
        }
      }
    }

    if (estimateMessageTokens(result) <= tierConfig.contextBudget) {
      return result;
    }

    // Phase 3: Drop oldest middle messages (keep first user + last N)
    const toDrop = Math.max(1, Math.floor((safeEnd - safeStart) / 2));
    result.splice(safeStart, toDrop);

    return result;
  };
}

/** Count messages in the last N complete turns from the end. */
function countTailMessages(messages: unknown[], turnCount: number): number {
  let turns = 0;
  let count = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    count++;
    if (isUser(messages[i])) {
      turns++;
      if (turns >= turnCount) break;
    }
  }
  return count;
}

/** Find the index of the first user message. */
function findFirstUserIndex(messages: unknown[]): number {
  for (let i = 0; i < messages.length; i++) {
    if (isUser(messages[i])) return i;
  }
  return -1;
}
