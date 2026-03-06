/**
 * Enhanced agent loop — factory + exports.
 *
 * Combines model tiers, context management, tool wrapping,
 * and turn governance into a single configuration object.
 */

export { classifyModelTier, getTierConfig, getTierGuidance } from './model-tiers';
export type { ModelTier, TierConfig } from './model-tiers';
export { createContextTransform } from './context-manager';
export { wrapTools } from './tool-wrapper';
export { createTurnGovernor } from './turn-governor';

import type { AgentTool } from '@mariozechner/pi-agent-core';
import type { ResolvedModel } from '../types';
import type { ModelTier, TierConfig } from './model-tiers';
import { classifyModelTier, getTierConfig, getTierGuidance } from './model-tiers';
import { createContextTransform } from './context-manager';
import { wrapTools } from './tool-wrapper';

export interface EnhancedAgentConfig {
  tools: AgentTool[];
  systemPrompt: string;
  transformContext: (messages: unknown[]) => Promise<unknown[]>;
  tier: ModelTier;
  tierConfig: TierConfig;
}

/**
 * Create an enhanced agent configuration.
 *
 * - Classifies model into a tier
 * - Wraps tools with dedup/error enrichment/compression
 * - Appends tier guidance to system prompt
 * - Creates transformContext for context window management
 */
export function createEnhancedAgentConfig(
  resolvedModel: ResolvedModel,
  tools: AgentTool[],
  systemPrompt: string,
): EnhancedAgentConfig {
  const tier = classifyModelTier(resolvedModel);
  const tierConfig = getTierConfig(tier);

  return {
    tools: wrapTools(tools, tierConfig),
    systemPrompt: systemPrompt + getTierGuidance(tier),
    transformContext: createContextTransform(tierConfig),
    tier,
    tierConfig,
  };
}
