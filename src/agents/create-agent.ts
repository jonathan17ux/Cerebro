/**
 * Factory: creates a pi-agent-core Agent per expert configuration.
 */

import { Agent } from '@mariozechner/pi-agent-core';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import type { Model, Message } from '@mariozechner/pi-ai';
import type { ResolvedModel } from './types';
import { createBackendStreamFn } from './stream-fn';

interface CreateAgentConfig {
  systemPrompt: string;
  resolvedModel: ResolvedModel;
  tools: AgentTool[];
  backendPort: number;
  maxTurns?: number;
  /** Optional context window transform applied before each LLM call. */
  transformContext?: (messages: unknown[], signal?: AbortSignal) => Promise<unknown[]>;
  /** Tool names for fuzzy matching in stream-fn (helps small models). */
  toolNames?: string[];
}

/**
 * Create a Model object that pi-agent-core expects.
 * We're using a custom streamFn, so most of these fields are just metadata.
 */
function toModel(resolved: ResolvedModel): Model<any> {
  const apiMap: Record<string, string> = {
    anthropic: 'anthropic-messages',
    openai: 'openai-completions',
    google: 'google-generative-ai',
  };

  return {
    id: resolved.modelId,
    name: resolved.displayName,
    api: (resolved.provider ? apiMap[resolved.provider] : 'openai-completions') as any,
    provider: resolved.provider || 'cerebro',
    baseUrl: '', // Not used — we route through our backend
    reasoning: false,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128_000,
    maxTokens: 4096,
  };
}

export function createExpertAgent(config: CreateAgentConfig): Agent {
  const model = toModel(config.resolvedModel);
  const streamFn = createBackendStreamFn(config.resolvedModel, config.backendPort, config.toolNames);

  const opts: Record<string, unknown> = {
    initialState: {
      systemPrompt: config.systemPrompt,
      model,
      tools: config.tools,
      thinkingLevel: 'off',
    },
    streamFn: streamFn as any,
    convertToLlm: (messages: unknown[]) => messages as Message[],
  };

  if (config.transformContext) {
    opts.transformContext = config.transformContext;
  }

  const agent = new Agent(opts as any);
  return agent;
}
