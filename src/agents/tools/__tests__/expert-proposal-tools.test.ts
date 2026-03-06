import { describe, it, expect, afterEach } from 'vitest';
import http from 'node:http';
import { createProposeExpert } from '../expert-proposal-tools';
import type { ToolContext } from '../../types';

// ── Mock helpers ────────────────────────────────────────────────

function createMockBackend(experts: { id: string; name: string }[]) {
  return http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');

    if (req.url?.startsWith('/experts')) {
      res.writeHead(200);
      res.end(JSON.stringify({ experts }));
    } else {
      res.writeHead(404);
      res.end('{}');
    }
  });
}

function listenOnRandomPort(server: http.Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      resolve(typeof addr === 'object' ? addr!.port : 0);
    });
  });
}

function closeServer(server: http.Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

function makeCtx(port: number): ToolContext {
  return {
    expertId: null,
    conversationId: 'conv-1',
    scope: 'personal',
    scopeId: null,
    backendPort: port,
  };
}

function extractText(result: any): string {
  return result.content[0].text;
}

const VALID_PARAMS = {
  name: 'Fitness Coach',
  description: 'Helps users build workout habits and track progress',
  domain: 'fitness',
  identity:
    'You are a personal fitness coach who helps users build sustainable workout habits. ' +
    'You are encouraging but realistic, and you prioritize proper form and injury prevention.',
  capabilities:
    '- Track and log workouts using save_entry\n' +
    '- Remember user preferences and fitness goals using save_fact\n' +
    '- Search for exercise techniques and nutrition info using web_search\n' +
    '- Create personalized workout plans based on user\'s level and goals',
  rules:
    '1. Always ask about injuries or limitations before suggesting exercises\n' +
    '2. Never recommend extreme diets or dangerous training protocols\n' +
    '3. Track progress over time — reference past workouts when planning new ones\n' +
    '4. Be encouraging but honest about realistic timelines',
};

// ── propose_expert ──────────────────────────────────────────────

describe('propose_expert', () => {
  let server: http.Server;

  afterEach(async () => {
    if (server) await closeServer(server);
  });

  it('returns valid proposal JSON with assembled sections', async () => {
    server = createMockBackend([]);
    const port = await listenOnRandomPort(server);
    const ctx = makeCtx(port);
    const tool = createProposeExpert(ctx);

    const result = await tool.execute('tc1', VALID_PARAMS);
    const proposal = JSON.parse(extractText(result));

    expect(proposal.type).toBe('expert_proposal');
    expect(proposal.name).toBe('Fitness Coach');
    expect(proposal.description).toBe('Helps users build workout habits and track progress');
    expect(proposal.domain).toBe('fitness');
    expect(proposal.systemPrompt).toContain('## Identity & Role');
    expect(proposal.systemPrompt).toContain('## Capabilities');
    expect(proposal.systemPrompt).toContain('## Rules');
    expect(proposal.systemPrompt).toContain('## Communication Style');
  });

  it('includes optional sections when provided', async () => {
    server = createMockBackend([]);
    const port = await listenOnRandomPort(server);
    const ctx = makeCtx(port);
    const tool = createProposeExpert(ctx);

    const result = await tool.execute('tc1', {
      ...VALID_PARAMS,
      expertise: 'Familiar with RPE-based training and progressive overload principles.',
      style: 'Warm and motivating. Uses bullet points for workout plans.',
    });
    const proposal = JSON.parse(extractText(result));

    expect(proposal.systemPrompt).toContain('## Domain Knowledge');
    expect(proposal.systemPrompt).toContain('RPE-based training');
    expect(proposal.systemPrompt).toContain('## Communication Style');
    expect(proposal.systemPrompt).toContain('Warm and motivating');
  });

  it('uses default style when omitted', async () => {
    server = createMockBackend([]);
    const port = await listenOnRandomPort(server);
    const ctx = makeCtx(port);
    const tool = createProposeExpert(ctx);

    const result = await tool.execute('tc1', VALID_PARAMS);
    const proposal = JSON.parse(extractText(result));

    expect(proposal.systemPrompt).toContain('concise and direct');
  });

  it('detects duplicate experts by similar name', async () => {
    const experts = [{ id: 'e1', name: 'Personal Fitness Coach' }];
    server = createMockBackend(experts);
    const port = await listenOnRandomPort(server);
    const ctx = makeCtx(port);
    const tool = createProposeExpert(ctx);

    // "Fitness Coach" shares high overlap with "Personal Fitness Coach"
    const result = await tool.execute('tc1', VALID_PARAMS);
    expect(extractText(result)).toContain('similar expert already exists');
    expect(extractText(result)).toContain('Personal Fitness Coach');
  });

  it('allows proposals with sufficiently different names', async () => {
    const experts = [{ id: 'e1', name: 'Code Reviewer' }];
    server = createMockBackend(experts);
    const port = await listenOnRandomPort(server);
    const ctx = makeCtx(port);
    const tool = createProposeExpert(ctx);

    const result = await tool.execute('tc1', VALID_PARAMS);
    const proposal = JSON.parse(extractText(result));
    expect(proposal.type).toBe('expert_proposal');
    expect(proposal.name).toBe('Fitness Coach');
  });

  it('rejects too-brief prompts', async () => {
    server = createMockBackend([]);
    const port = await listenOnRandomPort(server);
    const ctx = makeCtx(port);
    const tool = createProposeExpert(ctx);

    const result = await tool.execute('tc1', {
      name: 'X',
      description: 'Y',
      domain: 'z',
      identity: 'Short.',
      capabilities: '- One',
      rules: '1. Rule',
    });
    expect(extractText(result)).toContain('too brief');
  });

  it('preserves suggestedContextFile when provided', async () => {
    server = createMockBackend([]);
    const port = await listenOnRandomPort(server);
    const ctx = makeCtx(port);
    const tool = createProposeExpert(ctx);

    const contextFile = '## My Profile\n\n**Level:** \n**Goals:** ';
    const result = await tool.execute('tc1', {
      ...VALID_PARAMS,
      suggested_context_file: contextFile,
    });
    const proposal = JSON.parse(extractText(result));
    expect(proposal.suggestedContextFile).toBe(contextFile);
  });

  it('preserves toolAccess when specified', async () => {
    server = createMockBackend([]);
    const port = await listenOnRandomPort(server);
    const ctx = makeCtx(port);
    const tool = createProposeExpert(ctx);

    const result = await tool.execute('tc1', {
      ...VALID_PARAMS,
      tool_access: ['web_search', 'save_entry', 'recall_knowledge'],
    });
    const proposal = JSON.parse(extractText(result));
    expect(proposal.toolAccess).toEqual(['web_search', 'save_entry', 'recall_knowledge']);
  });
});
