/**
 * Delegation tools — delegate_to_expert and list_experts.
 * These are Cerebro-only tools that enable routing user requests to specialist experts.
 */

import { Type } from '@sinclair/typebox';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import type { ToolContext, RendererAgentEvent } from '../types';
import { backendRequest, textResult, isSimilarName } from './tool-utils';

interface ExpertRecord {
  id: string;
  name: string;
  domain: string | null;
  description: string;
  type: string;
  is_enabled: boolean;
}

interface ExpertListResponse {
  experts: ExpertRecord[];
  total: number;
}

export function createDelegateToExpert(ctx: ToolContext): AgentTool {
  return {
    name: 'delegate_to_expert',
    description:
      'Delegate a task to a specialist expert. The expert will run autonomously with their own system prompt and tools, then return their response. ' +
      'Provide a clear, complete task description — the expert cannot see your conversation history. ' +
      'Use the expert ID from the Available Experts catalog.',
    label: 'Delegate to Expert',
    parameters: Type.Object({
      expert_id: Type.String({
        description: 'The expert ID (from the [ID: xxx] in the expert catalog)',
      }),
      task: Type.String({
        description:
          'Clear, complete description of what the expert should do. Include all relevant context ' +
          'from the conversation since the expert cannot see chat history.',
      }),
      context: Type.Optional(
        Type.String({
          description:
            'Additional context the expert needs (user preferences, constraints, prior information). ' +
            'Include anything relevant that the expert would not know from their own system prompt.',
        }),
      ),
    }),
    execute: async (_toolCallId, params) => {
      // Validate we have the runtime and webContents
      if (!ctx.agentRuntime || !ctx.webContents) {
        return textResult('Delegation is not available in this context.');
      }

      // Fetch expert to validate it exists and is enabled
      let expert: ExpertRecord;
      try {
        expert = await backendRequest<ExpertRecord>(
          ctx.backendPort,
          'GET',
          `/experts/${params.expert_id}`,
        );
      } catch {
        return textResult(
          `Expert with ID "${params.expert_id}" not found. Use \`list_experts\` to see available experts.`,
        );
      }

      if (!expert.is_enabled) {
        return textResult(
          `Expert "${expert.name}" is currently disabled. The user can re-enable it in the Experts screen.`,
        );
      }

      // Compose the prompt from task + context
      let prompt = params.task;
      if (params.context) {
        prompt += `\n\nAdditional context:\n${params.context}`;
      }

      // Emit delegation_start event to the renderer
      const parentRunId = ctx.parentRunId!;
      const channel = `agent:event:${parentRunId}`;
      if (!ctx.webContents.isDestroyed()) {
        ctx.webContents.send(channel, {
          type: 'delegation_start',
          parentRunId,
          childRunId: '', // Will be filled after startRun
          expertId: expert.id,
          expertName: expert.name,
        } as RendererAgentEvent);
      }

      // Start the sub-agent run
      let childRunId: string;
      try {
        childRunId = await ctx.agentRuntime.startRun(ctx.webContents, {
          conversationId: `delegate:${parentRunId}:${expert.id}`,
          content: prompt,
          expertId: expert.id,
          parentRunId,
        });
      } catch (err) {
        return textResult(
          `Failed to start expert "${expert.name}": ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      // Wait for completion
      try {
        const result = await ctx.agentRuntime.waitForCompletion(childRunId, 120_000);

        // Emit delegation_end
        if (!ctx.webContents.isDestroyed()) {
          ctx.webContents.send(channel, {
            type: 'delegation_end',
            parentRunId,
            childRunId,
            status: result.status,
          } as RendererAgentEvent);
        }

        if (result.status === 'error') {
          return textResult(
            `Expert "${expert.name}" encountered an error: ${result.error || 'Unknown error'}. ` +
            `You may want to try again or handle the task directly.`,
          );
        }

        return textResult(
          `[Response from ${expert.name}]\n\n${result.messageContent}`,
        );
      } catch (err) {
        // Emit delegation_end with error status
        if (!ctx.webContents.isDestroyed()) {
          ctx.webContents.send(channel, {
            type: 'delegation_end',
            parentRunId,
            childRunId,
            status: 'error',
          } as RendererAgentEvent);
        }

        return textResult(
          `Delegation to "${expert.name}" failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },
  };
}

export function createListExperts(ctx: ToolContext): AgentTool {
  return {
    name: 'list_experts',
    description:
      'List available experts with their IDs, domains, and descriptions. ' +
      'Use this when you need to find the right expert for a task, or when the expert catalog in your system prompt is truncated.',
    label: 'List Experts',
    parameters: Type.Object({
      type: Type.Optional(
        Type.Union([Type.Literal('expert'), Type.Literal('team')], {
          description: 'Filter by expert type. Omit to show all.',
        }),
      ),
      search: Type.Optional(
        Type.String({
          description: 'Search term to filter experts by name or description',
        }),
      ),
    }),
    execute: async (_toolCallId, params) => {
      let url = '/experts?is_enabled=true&limit=50';
      if (params.type) {
        url += `&type=${encodeURIComponent(params.type)}`;
      }

      let experts: ExpertRecord[];
      try {
        const res = await backendRequest<ExpertListResponse>(
          ctx.backendPort,
          'GET',
          url,
        );
        experts = res.experts;
      } catch (err) {
        return textResult(
          `Failed to fetch experts: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      // Client-side search filter
      if (params.search) {
        const search = params.search.toLowerCase();
        experts = experts.filter(
          (e) =>
            e.name.toLowerCase().includes(search) ||
            e.description.toLowerCase().includes(search) ||
            (e.domain && e.domain.toLowerCase().includes(search)) ||
            isSimilarName(e.name, params.search!),
        );
      }

      if (experts.length === 0) {
        const qualifier = params.search ? ` matching "${params.search}"` : '';
        return textResult(
          `No enabled experts found${qualifier}. You can propose creating one with \`propose_expert\`.`,
        );
      }

      const lines = experts.map((e) => {
        const detail = e.domain ? ` (domain: ${e.domain})` : e.type === 'team' ? ' (team)' : '';
        return `- **${e.name}** [ID: ${e.id}]${detail}: ${e.description}`;
      });

      return textResult(
        `Found ${experts.length} expert(s):\n\n${lines.join('\n')}`,
      );
    },
  };
}
