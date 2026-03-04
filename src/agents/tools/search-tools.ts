/**
 * Web search tools for the agent system.
 */

import { Type } from '@sinclair/typebox';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import type { ToolContext } from '../types';
import { backendRequest, textResult } from './tool-utils';

interface SearchResultItem {
  title: string;
  url: string;
  content: string;
  score: number;
}

interface SearchResponseData {
  query: string;
  results: SearchResultItem[];
  answer: string | null;
}

export function createWebSearch(ctx: ToolContext): AgentTool {
  return {
    name: 'web_search',
    description:
      'Search the web for current information. Use when the user asks about recent events, needs real-time data, or asks questions beyond your training data.',
    label: 'Web Search',
    parameters: Type.Object({
      query: Type.String({ description: 'Search query' }),
      max_results: Type.Optional(
        Type.Number({ description: 'Max results (default 5)', default: 5 }),
      ),
    }),
    execute: async (_toolCallId, params) => {
      let res: SearchResponseData;
      try {
        res = await backendRequest<SearchResponseData>(ctx.backendPort, 'POST', '/search', {
          query: params.query,
          max_results: params.max_results ?? 5,
        });
      } catch (err) {
        return textResult(`Web search failed: ${err instanceof Error ? err.message : String(err)}`);
      }

      // Handle error responses from the backend (e.g. no API key)
      if (!res.results) {
        const detail = (res as any)?.detail ?? '';
        if (detail.toLowerCase().includes('no tavily api key') || detail.toLowerCase().includes('api key')) {
          return textResult(
            'Web search is not available — no Tavily API key is configured. ' +
            'Tell the user they can add a free Tavily API key in Integrations → Connected Apps to enable web search.',
          );
        }
        return textResult(`Web search error: ${detail || 'No search results returned.'}`);
      }

      if (res.results.length === 0) {
        return textResult('No search results found.');
      }

      const lines = res.results.map(
        (r, i) => `${i + 1}. **${r.title}**\n   ${r.content}\n   Source: ${r.url}`,
      );
      let text = `Found ${res.results.length} results for "${params.query}":\n\n${lines.join('\n\n')}`;
      if (res.answer) text = `Summary: ${res.answer}\n\n${text}`;
      return textResult(text);
    },
  };
}
