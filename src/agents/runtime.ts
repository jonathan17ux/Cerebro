/**
 * AgentRuntime — manages concurrent Agent instances.
 */

import http from 'node:http';
import crypto from 'node:crypto';
import type { WebContents } from 'electron';
import type { Agent, AgentEvent } from '@mariozechner/pi-agent-core';
import type { AgentRunRequest, ActiveRunInfo, RendererAgentEvent, ExpertModelConfig, SubAgentResult } from './types';
import type { ExecutionEngine } from '../engine/engine';
import { resolveModel } from './model-resolver';
import { createToolsForExpert } from './tools';
import { createExpertAgent } from './create-agent';
import { translateEvent } from './events';

const MAX_CONCURRENT_RUNS = 5;

interface ActiveRun {
  runId: string;
  conversationId: string;
  expertId: string | null;
  userContent: string;
  agent: Agent;
  unsubscribe: () => void;
  startedAt: number;
  accumulatedText: string;
}

interface ExpertData {
  id: string;
  system_prompt: string | null;
  model_config_json: string | null;
  tool_access: string | null;
  max_turns: number;
  token_budget: number;
}

export class AgentRuntime {
  private activeRuns = new Map<string, ActiveRun>();
  private runCompletions = new Map<string, {
    resolve: (result: SubAgentResult) => void;
    reject: (error: Error) => void;
  }>();
  private backendPort: number;
  private executionEngine: ExecutionEngine | null = null;

  constructor(backendPort: number) {
    this.backendPort = backendPort;
  }

  setExecutionEngine(engine: ExecutionEngine): void {
    this.executionEngine = engine;
  }

  /**
   * Wait for a run to complete. Used by delegation tools to wait for sub-agent results.
   */
  waitForCompletion(runId: string, timeoutMs = 120_000): Promise<SubAgentResult> {
    return new Promise<SubAgentResult>((resolve, reject) => {
      // If the run is already gone, it completed before we started waiting
      const existing = this.activeRuns.get(runId);
      if (!existing) {
        reject(new Error(`Run ${runId} not found or already completed`));
        return;
      }

      this.runCompletions.set(runId, { resolve, reject });

      // Timeout guard
      const timer = setTimeout(() => {
        this.runCompletions.delete(runId);
        reject(new Error(`Delegation timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      // Clean up timer when resolved/rejected
      const original = this.runCompletions.get(runId)!;
      this.runCompletions.set(runId, {
        resolve: (result) => {
          clearTimeout(timer);
          original.resolve(result);
        },
        reject: (err) => {
          clearTimeout(timer);
          original.reject(err);
        },
      });
    });
  }

  async startRun(
    webContents: WebContents,
    request: AgentRunRequest,
  ): Promise<string> {
    if (this.activeRuns.size >= MAX_CONCURRENT_RUNS) {
      throw new Error('Too many concurrent agent runs');
    }

    const runId = crypto.randomUUID().replace(/-/g, '').slice(0, 32);
    const { conversationId, content, expertId } = request;

    // Fetch expert config if specified
    let expertData: ExpertData | null = null;
    if (expertId) {
      expertData = await this.fetchExpert(expertId);
    }

    // Parse model config
    let expertModelConfig: ExpertModelConfig | null = null;
    if (expertData?.model_config_json) {
      try {
        expertModelConfig = JSON.parse(expertData.model_config_json);
      } catch {
        // Invalid JSON, use default
      }
    }

    // Resolve model — throw so the renderer catch block can show a modal
    const resolvedModel = await resolveModel(expertModelConfig, this.backendPort);
    if (!resolvedModel) {
      throw new Error('No model is currently available. Go to Integrations to configure a model.');
    }

    // Fetch memory-assembled system prompt
    let systemPrompt = expertData?.system_prompt || '';
    try {
      const scope = expertId ? 'expert' : 'personal';
      const scopeId = expertId || null;
      const isPersonalScope = scope === 'personal';
      const memoryRes = await this.backendPost<{ system_prompt: string }>(
        '/memory/context',
        {
          messages: [{ role: 'user', content }],
          scope,
          scope_id: scopeId,
          include_expert_catalog: isPersonalScope,
          include_routine_catalog: isPersonalScope,
        },
      );
      if (memoryRes?.system_prompt) {
        systemPrompt = memoryRes.system_prompt;
      }
    } catch {
      // Memory is non-critical
    }

    // Inject recent conversation history so the LLM has multi-turn context.
    // Truncate individual messages to avoid blowing the token budget.
    if (request.recentMessages && request.recentMessages.length > 0) {
      const MAX_MSG_CHARS = 500;
      const transcript = request.recentMessages
        .map((m) => {
          const tag = m.role === 'user' ? 'user' : 'assistant';
          const text = m.content.length > MAX_MSG_CHARS
            ? m.content.slice(0, MAX_MSG_CHARS) + '...(truncated)'
            : m.content;
          return `<${tag}>${text}</${tag}>`;
        })
        .join('\n');
      systemPrompt += `\n\n## Recent Conversation History\nThe following is the recent conversation with the user. Use this context to understand follow-ups, avoid repeating yourself, and maintain conversational continuity.\n\n${transcript}`;
    }

    // Inject routine proposal context so the LLM knows what it already proposed.
    // Cap at 20 to avoid system prompt bloat in long conversations.
    if (request.routineProposals && request.routineProposals.length > 0) {
      const proposals = request.routineProposals.slice(-20);
      const lines = proposals.map(
        (p) => `- "${p.name}" → ${p.status}`,
      );
      systemPrompt += `\n\n## Prior Routine Proposals (this conversation)\n${lines.join('\n')}\n` +
        `If a proposal was dismissed, do NOT re-propose it. If saved, the user already has it.`;
    }

    // Inject expert proposal context so the LLM knows what it already proposed.
    if (request.expertProposals && request.expertProposals.length > 0) {
      const proposals = request.expertProposals.slice(-20);
      const lines = proposals.map(
        (p) => `- "${p.name}" → ${p.status}`,
      );
      systemPrompt += `\n\n## Prior Expert Proposals (this conversation)\n${lines.join('\n')}\n` +
        `If a proposal was dismissed, do NOT re-propose it. If saved, the user already has it.`;
    }

    // Build tools
    const toolCtx = {
      expertId: expertId || null,
      conversationId,
      scope: expertId ? 'expert' : 'personal',
      scopeId: expertId || null,
      backendPort: this.backendPort,
      executionEngine: this.executionEngine ?? undefined,
      webContents,
      agentRuntime: this as AgentRuntime,
      parentRunId: runId,
    };
    const toolAccess = expertData?.tool_access ? JSON.parse(expertData.tool_access) : null;
    const tools = createToolsForExpert(toolCtx, toolAccess);

    // Create agent
    const agent = createExpertAgent({
      systemPrompt,
      resolvedModel,
      tools,
      backendPort: this.backendPort,
      maxTurns: expertData?.max_turns ?? 10,
    });

    // Create agent run record in backend
    this.backendPost('/agent-runs', {
      id: runId,
      expert_id: expertId || null,
      conversation_id: conversationId,
      parent_run_id: request.parentRunId || null,
      status: 'running',
    }).catch(console.error);

    // Subscribe to events
    const channel = `agent:event:${runId}`;
    const turnCount = { value: 0 };
    let accumulatedText = '';
    const toolsUsed = new Set<string>();

    const unsubscribe = agent.subscribe((event: AgentEvent) => {
      // Track accumulated text for text_delta events
      if (event.type === 'message_update') {
        const ame = (event as any).assistantMessageEvent;
        if (ame?.type === 'text_delta') {
          accumulatedText += ame.delta;
        }
      }

      // Track tools used
      if (event.type === 'tool_execution_start') {
        toolsUsed.add(event.toolName);
      }

      const translated = translateEvent(event, runId, turnCount);
      if (translated) {
        if (!webContents.isDestroyed()) {
          webContents.send(channel, translated);
        }
      }
    });

    const activeRun: ActiveRun = {
      runId,
      conversationId,
      expertId: expertId || null,
      userContent: content,
      agent,
      unsubscribe,
      startedAt: Date.now(),
      accumulatedText: '',
    };
    this.activeRuns.set(runId, activeRun);

    // Emit run_start
    if (!webContents.isDestroyed()) {
      webContents.send(channel, { type: 'run_start', runId } as RendererAgentEvent);
    }

    // Start the agent loop (non-blocking)
    agent
      .prompt(content)
      .then(() => {
        activeRun.accumulatedText = accumulatedText;
        this.finalizeRun(runId, 'completed', webContents, accumulatedText, undefined, toolsUsed);

        // Resolve any delegation waiters
        const completion = this.runCompletions.get(runId);
        if (completion) {
          this.runCompletions.delete(runId);
          completion.resolve({
            runId,
            status: 'completed',
            messageContent: accumulatedText,
          });
        }
      })
      .catch((err: Error) => {
        activeRun.accumulatedText = accumulatedText;
        const errorMsg = err.message || 'Agent run failed';
        if (!webContents.isDestroyed()) {
          webContents.send(channel, {
            type: 'error',
            runId,
            error: errorMsg,
          } as RendererAgentEvent);
        }
        this.finalizeRun(runId, 'error', webContents, accumulatedText, errorMsg, toolsUsed);

        // Resolve any delegation waiters (with error status, not reject — let tool handle it)
        const completion = this.runCompletions.get(runId);
        if (completion) {
          this.runCompletions.delete(runId);
          completion.resolve({
            runId,
            status: 'error',
            messageContent: accumulatedText,
            error: errorMsg,
          });
        }
      });

    return runId;
  }

  cancelRun(runId: string): boolean {
    const run = this.activeRuns.get(runId);
    if (!run) return false;
    run.agent.abort();
    this.finalizeRun(runId, 'cancelled', null, run.accumulatedText);

    // Reject any delegation waiters
    const completion = this.runCompletions.get(runId);
    if (completion) {
      this.runCompletions.delete(runId);
      completion.reject(new Error('Run was cancelled'));
    }
    return true;
  }

  getActiveRuns(): ActiveRunInfo[] {
    return Array.from(this.activeRuns.values()).map((run) => ({
      runId: run.runId,
      conversationId: run.conversationId,
      expertId: run.expertId,
      startedAt: run.startedAt,
    }));
  }

  private finalizeRun(
    runId: string,
    status: string,
    _webContents: WebContents | null,
    messageContent: string,
    error?: string,
    toolsUsed?: Set<string>,
  ): void {
    const run = this.activeRuns.get(runId);
    if (!run) return;

    run.unsubscribe();
    this.activeRuns.delete(runId);

    // Update agent run record
    this.backendRequest('PATCH', `/agent-runs/${runId}`, {
      status,
      completed_at: new Date().toISOString(),
      error: error || null,
      tools_used: toolsUsed ? Array.from(toolsUsed) : null,
    }).catch(console.error);

    // Trigger memory extraction (fire-and-forget) if there's content
    if (messageContent && status === 'completed') {
      const scope = run.expertId ? 'expert' : 'personal';
      const scopeId = run.expertId || null;
      this.backendPost('/memory/extract', {
        conversation_id: run.conversationId,
        messages: [
          { role: 'user', content: run.userContent },
          { role: 'assistant', content: messageContent },
        ],
        scope,
        scope_id: scopeId,
      }).catch(() => {
        // Extraction is non-critical
      });
    }
  }

  private async fetchExpert(expertId: string): Promise<ExpertData | null> {
    try {
      return await this.backendGet<ExpertData>(`/experts/${expertId}`);
    } catch {
      return null;
    }
  }

  private backendGet<T>(path: string): Promise<T | null> {
    return new Promise((resolve) => {
      const req = http.get(`http://127.0.0.1:${this.backendPort}${path}`, (res) => {
        if (res.statusCode !== 200) {
          resolve(null);
          res.resume();
          return;
        }
        let data = '';
        res.on('data', (chunk: Buffer) => {
          data += chunk.toString();
        });
        res.on('end', () => {
          try {
            resolve(JSON.parse(data) as T);
          } catch {
            resolve(null);
          }
        });
      });
      req.on('error', () => resolve(null));
      req.setTimeout(10_000, () => {
        req.destroy();
        resolve(null);
      });
    });
  }

  private backendPost<T>(path: string, body: unknown): Promise<T | null> {
    return this.backendRequest('POST', path, body);
  }

  private backendRequest<T>(method: string, path: string, body: unknown): Promise<T | null> {
    return new Promise((resolve) => {
      const bodyStr = JSON.stringify(body);
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port: this.backendPort,
          path,
          method,
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(bodyStr).toString(),
          },
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
              resolve(null);
            }
          });
        },
      );
      req.on('error', () => resolve(null));
      req.on('timeout', () => {
        req.destroy();
        resolve(null);
      });
      req.write(bodyStr);
      req.end();
    });
  }
}
