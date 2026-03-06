/**
 * Expert proposal tool for the agent system.
 * Uses structured prompt scaffolding — the LLM fills focused sections (identity,
 * capabilities, rules) instead of writing one big free-form system prompt.
 * This drastically improves output quality from small local models (4B-8B).
 */

import { Type } from '@sinclair/typebox';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import type { ToolContext } from '../types';
import { backendRequest, textResult, isSimilarName } from './tool-utils';

interface ExpertRecord {
  id: string;
  name: string;
}

export function createProposeExpert(ctx: ToolContext): AgentTool {
  return {
    name: 'propose_expert',
    description:
      'Propose creating a new specialist expert. Use this when the user needs recurring, domain-specific help ' +
      'that no existing expert covers. The proposal will be shown inline for the user to review and save. ' +
      'Fill in focused sections (identity, capabilities, rules) — they will be assembled into a full system prompt.',
    label: 'Propose Expert',
    parameters: Type.Object({
      name: Type.String({
        description: 'Short, descriptive name for the expert (e.g. "Fitness Coach", "Code Reviewer")',
      }),
      description: Type.String({
        description: 'Brief description of what this expert does (1-2 sentences)',
      }),
      domain: Type.String({
        description: 'Primary domain or area of expertise (e.g. "fitness", "software engineering", "cooking")',
      }),
      identity: Type.String({
        description:
          'Identity paragraph (2-4 sentences). Start with "You are a..." and describe the expert\'s role, ' +
          'personality, and approach. Example: "You are a personal fitness coach who helps users build ' +
          'sustainable workout habits. You are encouraging but realistic, and you prioritize proper form ' +
          'and injury prevention over intensity."',
      }),
      capabilities: Type.String({
        description:
          'Capabilities section (3-5 bullet points, one per line starting with "- "). Describe what the expert ' +
          'can do using their available tools. Example:\n' +
          '"- Track and log workouts using save_entry\\n' +
          '- Remember user preferences and fitness goals using save_fact\\n' +
          '- Search for exercise techniques and nutrition info using web_search\\n' +
          '- Create personalized workout plans based on user\'s level and goals"',
      }),
      rules: Type.String({
        description:
          'Rules section (3-6 rules, one per line starting with a number). Include safety guardrails relevant ' +
          'to the domain. Example:\n' +
          '"1. Always ask about injuries or limitations before suggesting exercises\\n' +
          '2. Never recommend extreme diets or dangerous training protocols\\n' +
          '3. Track progress over time — reference past workouts when planning new ones\\n' +
          '4. Be encouraging but honest about realistic timelines"',
      }),
      expertise: Type.Optional(
        Type.String({
          description:
            'Optional domain knowledge section — key frameworks, methodologies, or specialized knowledge. ' +
            'Example: "Familiar with RPE-based training, progressive overload principles, and periodization. ' +
            'Knows common movement patterns (squat, hinge, push, pull) and can suggest alternatives."',
        }),
      ),
      style: Type.Optional(
        Type.String({
          description:
            'Optional communication style preferences. Default: "concise and direct". ' +
            'Example: "Warm and motivating. Uses bullet points for workout plans. Keeps responses short ' +
            'unless explaining technique."',
        }),
      ),
      tool_access: Type.Optional(
        Type.Array(Type.String(), {
          description:
            'Explicit list of tool names this expert should have access to. ' +
            'If omitted, the expert gets the default tool set. Available tools: ' +
            'recall_facts, recall_knowledge, save_fact, save_entry, get_current_time, get_user_profile, web_search',
        }),
      ),
      suggested_context_file: Type.Optional(
        Type.String({
          description:
            'Optional markdown template for the expert\'s context file. Write this as questions for the USER ' +
            'to fill in, not as answers. Example for a fitness coach:\n' +
            '"## My Fitness Profile\\n\\n' +
            '**Current fitness level:** (beginner/intermediate/advanced)\\n' +
            '**Goals:** \\n' +
            '**Injuries or limitations:** \\n' +
            '**Available equipment:** \\n' +
            '**Preferred workout days:** "',
        }),
      ),
    }),
    execute: async (_toolCallId, params) => {
      // Check for duplicate experts before proposing
      try {
        const res = await backendRequest<{ experts: ExpertRecord[] }>(
          ctx.backendPort,
          'GET',
          '/experts?is_enabled=true&limit=200',
        );
        const duplicate = res.experts.find((e) => isSimilarName(e.name, params.name));
        if (duplicate) {
          return textResult(
            `A similar expert already exists: "${duplicate.name}" (ID: ${duplicate.id}). ` +
            `Suggest delegating to them with \`delegate_to_expert\` or ask the user if they want to update the existing one.`,
          );
        }
      } catch {
        // Non-critical — proceed with proposal if backend is unreachable
      }

      // Assemble structured sections into a full system prompt
      const sections: string[] = [];

      sections.push(`## Identity & Role\n${params.identity}`);
      sections.push(`## Capabilities\n${params.capabilities}`);
      sections.push(`## Rules\n${params.rules}`);

      if (params.expertise) {
        sections.push(`## Domain Knowledge\n${params.expertise}`);
      }

      sections.push(`## Communication Style\n${params.style ?? 'Be concise and direct. Prefer short, clear responses over verbose ones.'}`);

      const systemPrompt = sections.join('\n\n');

      // Validate minimum quality (headers + default style add ~130 chars of boilerplate,
      // so 200 ensures the user content itself is substantive)
      if (systemPrompt.length < 200) {
        return textResult(
          'The assembled system prompt is too brief (under 200 characters). ' +
          'Please provide more detail in the identity, capabilities, and rules sections.',
        );
      }

      const proposal = {
        type: 'expert_proposal',
        name: params.name,
        description: params.description,
        domain: params.domain,
        systemPrompt,
        toolAccess: params.tool_access ?? [],
        suggestedContextFile: params.suggested_context_file,
      };
      return textResult(JSON.stringify(proposal));
    },
  };
}
