/**
 * Tool enhancement layer — dedup, error enrichment, result compression.
 *
 * Wraps each tool's execute() before passing to the Agent.
 */

import crypto from 'node:crypto';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import type { TierConfig } from './model-tiers';

const DEFAULT_TOOL_TIMEOUT_MS = 30_000;
const DELEGATION_TOOL_TIMEOUT_MS = 180_000;
const MAX_DEDUP_CACHE_SIZE = 100;

const DELEGATION_TOOLS = new Set(['delegate_to_expert']);

interface CacheEntry {
  result: unknown;
  timestamp: number;
}

/**
 * Wrap tools with dedup, error enrichment, and result compression.
 * Returns new tool array (does not mutate originals).
 */
export function wrapTools(tools: AgentTool[], tierConfig: TierConfig): AgentTool[] {
  const dedupCache = new Map<string, CacheEntry>();

  return tools.map((tool) => ({
    ...tool,
    execute: wrapExecute(tool, tierConfig, dedupCache),
  }));
}

function hashCall(name: string, args: unknown): string {
  const input = name + JSON.stringify(args);
  return crypto.createHash('sha256').update(input).digest('hex');
}

function wrapExecute(
  tool: AgentTool,
  tierConfig: TierConfig,
  dedupCache: Map<string, CacheEntry>,
) {
  const originalExecute = tool.execute.bind(tool);
  const toolName = tool.name;

  return async (
    toolCallId: string,
    params: unknown,
    signal?: AbortSignal,
    onUpdate?: unknown,
  ) => {
    const hash = hashCall(toolName, params);

    // Dedup: return cached result if same call was made this run
    const cached = dedupCache.get(hash);
    if (cached) {
      const cachedResult = cached.result as { content: Array<{ type: string; text?: string }>; details: unknown };
      const text = cachedResult.content?.[0]?.text || '';
      return {
        content: [{ type: 'text' as const, text: text + '\n\n[Note: This is a cached result from an identical previous call.]' }],
        details: cachedResult.details,
      };
    }

    // Build a combined signal: caller's signal + per-tool timeout
    const timeoutMs = DELEGATION_TOOLS.has(toolName)
      ? DELEGATION_TOOL_TIMEOUT_MS
      : DEFAULT_TOOL_TIMEOUT_MS;
    const signals: AbortSignal[] = [AbortSignal.timeout(timeoutMs)];
    if (signal) signals.push(signal);
    const combinedSignal = AbortSignal.any(signals);

    // Execute with error enrichment and timeout
    let result: { content: Array<{ type: string; text?: string }>; details: unknown };
    try {
      result = await originalExecute(toolCallId, params, combinedSignal, onUpdate as any);
    } catch (err: unknown) {
      // On timeout, return a friendly error result instead of throwing
      if (err instanceof Error && err.name === 'TimeoutError') {
        return {
          content: [{ type: 'text' as const, text: `Tool "${toolName}" timed out after ${timeoutMs / 1000}s. Try a different approach or simplify the request.` }],
          details: undefined,
        };
      }
      const enriched = enrichError(err, toolName);
      return {
        content: [{ type: 'text' as const, text: enriched }],
        details: undefined,
      };
    }

    // Evict oldest entries if cache is full
    if (dedupCache.size >= MAX_DEDUP_CACHE_SIZE) {
      const oldest = dedupCache.keys().next().value;
      if (oldest !== undefined) dedupCache.delete(oldest);
    }

    // Cache the result
    dedupCache.set(hash, { result, timestamp: Date.now() });

    // Compress result if too large
    return compressResult(result, tierConfig.compressionThreshold);
  };
}

function enrichError(err: unknown, toolName: string): string {
  const message = err instanceof Error ? err.message : String(err);

  if (message.includes('not found') || message.includes('404')) {
    return `Tool "${toolName}" error: Resource not found. Verify the parameters are correct and try a different approach.`;
  }
  if (message.includes('validation') || message.includes('invalid') || message.includes('required')) {
    return `Tool "${toolName}" error: Invalid parameters — ${message}. Check the tool's parameter schema and try again.`;
  }
  if (message.includes('timeout') || message.includes('ETIMEDOUT')) {
    return `Tool "${toolName}" error: Request timed out. You can retry once, or try a different approach.`;
  }
  if (message.includes('ECONNREFUSED') || message.includes('connect')) {
    return `Tool "${toolName}" error: Backend connection failed. The service may be down — try a different approach.`;
  }

  return `Tool "${toolName}" error: ${message}. Consider trying a different approach.`;
}

function compressResult(
  result: { content: Array<{ type: string; text?: string }>; details: unknown },
  threshold: number,
): typeof result {
  if (!result.content || result.content.length === 0) return result;

  const totalLength = result.content.reduce(
    (sum, c) => sum + (c.text?.length || 0),
    0,
  );

  if (totalLength <= threshold) return result;

  // Compress text content
  const compressed = result.content.map((c) => {
    if (c.type !== 'text' || !c.text) return c;
    if (c.text.length <= threshold) return c;
    return {
      ...c,
      text: c.text.slice(0, threshold) + `\n\n[Result truncated from ${c.text.length} to ${threshold} chars. Key information is above.]`,
    };
  });

  return { content: compressed, details: result.details };
}
