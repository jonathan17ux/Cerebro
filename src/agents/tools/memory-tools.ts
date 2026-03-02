/**
 * Memory tools for the agent system.
 * recall_facts, recall_knowledge, save_fact, save_entry
 */

import http from 'node:http';
import { Type } from '@sinclair/typebox';
import type { AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core';
import type { ToolContext } from '../types';

function backendRequest<T>(port: number, method: string, path: string, body?: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    const bodyStr = body ? JSON.stringify(body) : undefined;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (bodyStr) headers['Content-Length'] = Buffer.byteLength(bodyStr).toString();

    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method,
        headers,
        timeout: 10_000,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk: Buffer) => {
          data += chunk.toString();
        });
        res.on('end', () => {
          try {
            resolve(JSON.parse(data) as T);
          } catch {
            resolve(data as T);
          }
        });
      },
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timed out'));
    });
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

function textResult(text: string): AgentToolResult<void> {
  return { content: [{ type: 'text', text }], details: undefined as any };
}

export function createRecallFacts(ctx: ToolContext): AgentTool {
  return {
    name: 'recall_facts',
    description:
      'Search learned facts about the user. Returns relevant facts based on a search query.',
    label: 'Recall Facts',
    parameters: Type.Object({
      query: Type.String({ description: 'Search query for relevant facts' }),
    }),
    execute: async (_toolCallId, params) => {
      const search = encodeURIComponent(params.query);
      const scope = ctx.scope;
      const scopeId = ctx.scopeId ? `&scope_id=${ctx.scopeId}` : '';
      const res = await backendRequest<{ items: Array<{ content: string }> }>(
        ctx.backendPort,
        'GET',
        `/memory/items?scope=${scope}${scopeId}&search=${search}&limit=10`,
      );
      if (!res.items || res.items.length === 0) {
        return textResult('No relevant facts found.');
      }
      const lines = res.items.map((item) => `- ${item.content}`);
      return textResult(`Found ${res.items.length} relevant facts:\n${lines.join('\n')}`);
    },
  };
}

export function createRecallKnowledge(ctx: ToolContext): AgentTool {
  return {
    name: 'recall_knowledge',
    description:
      'Search structured knowledge entries (events, records). Returns relevant entries based on a search query.',
    label: 'Recall Knowledge',
    parameters: Type.Object({
      query: Type.String({ description: 'Search query for relevant knowledge entries' }),
    }),
    execute: async (_toolCallId, params) => {
      const search = encodeURIComponent(params.query);
      const scope = ctx.scope;
      const scopeId = ctx.scopeId ? `&scope_id=${ctx.scopeId}` : '';
      const res = await backendRequest<{
        entries: Array<{ summary: string; entry_type: string; occurred_at: string }>;
      }>(
        ctx.backendPort,
        'GET',
        `/memory/knowledge?scope=${scope}${scopeId}&search=${search}&limit=10`,
      );
      if (!res.entries || res.entries.length === 0) {
        return textResult('No relevant knowledge entries found.');
      }
      const lines = res.entries.map(
        (e) => `- [${e.entry_type}] ${e.summary} (${e.occurred_at})`,
      );
      return textResult(
        `Found ${res.entries.length} relevant entries:\n${lines.join('\n')}`,
      );
    },
  };
}

export function createSaveFact(ctx: ToolContext): AgentTool {
  return {
    name: 'save_fact',
    description:
      'Save a learned fact about the user to memory. Use this when the user shares personal info, preferences, or important context.',
    label: 'Save Fact',
    parameters: Type.Object({
      content: Type.String({
        description: 'The fact to remember (concise, 1-2 sentences)',
      }),
    }),
    execute: async (_toolCallId, params) => {
      await backendRequest(ctx.backendPort, 'POST', '/memory/items', {
        scope: ctx.scope,
        scope_id: ctx.scopeId,
        content: params.content,
        source_conversation_id: ctx.conversationId,
      });
      return textResult(`Saved fact: "${params.content}"`);
    },
  };
}

export function createSaveEntry(ctx: ToolContext): AgentTool {
  return {
    name: 'save_entry',
    description:
      'Save a structured knowledge entry (an event, record, or activity). Use when the user reports activities, achievements, or structured data.',
    label: 'Save Entry',
    parameters: Type.Object({
      entry_type: Type.String({ description: 'Type of entry (e.g. "workout", "meeting", "purchase")' }),
      summary: Type.String({ description: 'Brief summary of the entry' }),
      content: Type.String({
        description: 'JSON string with structured details',
      }),
    }),
    execute: async (_toolCallId, params) => {
      await backendRequest(ctx.backendPort, 'POST', '/memory/knowledge', {
        scope: ctx.scope,
        scope_id: ctx.scopeId,
        entry_type: params.entry_type,
        occurred_at: new Date().toISOString(),
        summary: params.summary,
        content: params.content,
        source: 'agent',
        source_conversation_id: ctx.conversationId,
      });
      return textResult(`Saved ${params.entry_type} entry: "${params.summary}"`);
    },
  };
}
