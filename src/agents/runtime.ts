/**
 * AgentRuntime — manages concurrent Claude Code subprocess runs.
 *
 * This is the post-collapse implementation: every chat run spawns a
 * `claude -p ... --agent <name>` subprocess via ClaudeCodeRunner with
 * `cwd: <cerebro-data-dir>`. There is no JS agent loop, no model
 * resolver, no tool registry, no MCP bridge. Subagents are defined as
 * project-scoped Markdown files under `<dataDir>/.claude/agents/` by
 * the installer; delegation is handled by Claude Code's built-in
 * `Agent` tool inside its own subprocess.
 */

import http from 'node:http';
import crypto from 'node:crypto';
import type { WebContents } from 'electron';
import type { AgentRunRequest, ActiveRunInfo, RendererAgentEvent } from './types';
import { ClaudeCodeRunner } from '../claude-code/stream-adapter';
import { getAgentNameForExpert, installAll } from '../claude-code/installer';
import { IPC_CHANNELS } from '../types/ipc';

/** Cap concurrent runs to prevent spawning a wall of subprocesses. */
const MAX_CONCURRENT_RUNS = 5;

interface ActiveRun {
  runId: string;
  conversationId: string;
  expertId: string | null;
  userContent: string;
  startedAt: number;
  accumulatedText: string;
  runner: ClaudeCodeRunner;
}

interface ExpertNameLookup {
  id: string;
  name: string;
}

export class AgentRuntime {
  private activeRuns = new Map<string, ActiveRun>();
  private backendPort: number;
  private dataDir: string;
  private syncChain: Promise<void> = Promise.resolve();

  constructor(backendPort: number, dataDir: string) {
    this.backendPort = backendPort;
    this.dataDir = dataDir;
  }

  /**
   * Spawn a Claude Code subprocess for one chat turn.
   * Returns the runId immediately; events stream over `agent:event:<runId>`.
   */
  async startRun(
    webContents: WebContents,
    request: AgentRunRequest,
  ): Promise<string> {
    if (this.activeRuns.size >= MAX_CONCURRENT_RUNS) {
      throw new Error('Too many concurrent agent runs');
    }

    const runId = crypto.randomUUID().replace(/-/g, '').slice(0, 32);
    const { conversationId, content, expertId } = request;

    // Resolve which subagent to invoke. Default to the main "cerebro" agent
    // when no expert is specified. For experts, look up the slug from the
    // installer's sidecar index — if it's not there yet, fall back to a
    // backend fetch + re-derive (covers a freshly-created expert before
    // the next sync).
    let agentName = 'cerebro';
    if (expertId) {
      const fromIndex = getAgentNameForExpert(this.dataDir, expertId);
      if (fromIndex) {
        agentName = fromIndex;
      } else {
        const expert = await this.fetchExpertName(expertId);
        if (!expert) {
          throw new Error(`Expert ${expertId} not found`);
        }
        // Re-derive (matches expertAgentName) — falls through to the next sync
        // pass to actually write the file. If the file is missing, Claude Code
        // will error out and we surface that to the user.
        const { expertAgentName } = await import('../claude-code/installer');
        agentName = expertAgentName(expert.id, expert.name);
      }
    }

    // Build the prompt: prepend recent conversation history so the
    // subagent has multi-turn context. Uses XML tags to prevent the LLM
    // from treating history labels as turn-taking cues.
    let fullPrompt = content;
    if (request.recentMessages && request.recentMessages.length > 0) {
      const MAX_MSG_CHARS = 500;
      const MAX_MESSAGES = 10;
      const MAX_TOTAL_CHARS = 2000;
      const recent = request.recentMessages.slice(-MAX_MESSAGES);
      const lines: string[] = [];
      let totalChars = 0;
      for (const m of recent) {
        const tag = m.role === 'user' ? 'human' : 'assistant';
        const text = m.content.length > MAX_MSG_CHARS
          ? m.content.slice(0, MAX_MSG_CHARS) + '...(truncated)'
          : m.content;
        const line = `<${tag}>${text}</${tag}>`;
        if (totalChars + line.length > MAX_TOTAL_CHARS && lines.length > 0) break;
        lines.push(line);
        totalChars += line.length;
      }
      fullPrompt = `<conversation_history>\n${lines.join('\n')}\n</conversation_history>\n\n<instructions>\nThe above is prior conversation context for reference only. Do NOT continue the conversation or generate any text on behalf of the user. Do NOT output "User:" or simulate user messages. Only provide your single assistant response to the following request.\n</instructions>\n\n${content}`;
    }

    const channel = `agent:event:${runId}`;
    const runner = new ClaudeCodeRunner();

    const activeRun: ActiveRun = {
      runId,
      conversationId,
      expertId: expertId || null,
      userContent: content,
      startedAt: Date.now(),
      accumulatedText: '',
      runner,
    };

    this.activeRuns.set(runId, activeRun);

    // Persist agent_runs row (fire-and-forget — non-critical)
    this.backendPost('/agent-runs', {
      id: runId,
      expert_id: expertId || null,
      conversation_id: conversationId,
      parent_run_id: request.parentRunId || null,
      status: 'running',
    }).catch(console.error);

    // Emit run_start
    if (!webContents.isDestroyed()) {
      webContents.send(channel, { type: 'run_start', runId } as RendererAgentEvent);
    }

    // Forward stream events to renderer
    runner.on('event', (event: RendererAgentEvent) => {
      if (event.type === 'text_delta') {
        activeRun.accumulatedText += event.delta;
      }
      if (!webContents.isDestroyed()) {
        webContents.send(channel, event);
      }
    });

    runner.on('done', (messageContent: string) => {
      this.finalizeRun(runId, 'completed', messageContent);
      this.postRunSync(webContents);
    });

    runner.on('error', (error: string) => {
      if (!webContents.isDestroyed()) {
        webContents.send(channel, {
          type: 'error',
          runId,
          error,
        } as RendererAgentEvent);
      }
      this.finalizeRun(runId, 'error', activeRun.accumulatedText, error);
      this.postRunSync(webContents);
    });

    runner.start({
      runId,
      prompt: fullPrompt,
      agentName,
      cwd: this.dataDir,
    });

    return runId;
  }

  cancelRun(runId: string): boolean {
    const run = this.activeRuns.get(runId);
    if (!run) return false;
    run.runner.abort();
    this.finalizeRun(runId, 'cancelled', run.accumulatedText);
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

  // ── Internals ──────────────────────────────────────────────────

  /** Re-sync installer after every run so skill-created experts get materialized. */
  private postRunSync(webContents: WebContents): void {
    // Serialize to prevent concurrent installAll calls racing on the index file
    this.syncChain = this.syncChain
      .then(() => installAll({ dataDir: this.dataDir, backendPort: this.backendPort }))
      .then(() => {
        if (!webContents.isDestroyed()) {
          webContents.send(IPC_CHANNELS.EXPERTS_CHANGED);
        }
      })
      .catch(console.error);
  }

  private finalizeRun(
    runId: string,
    status: 'completed' | 'error' | 'cancelled',
    messageContent: string,
    error?: string,
  ): void {
    const run = this.activeRuns.get(runId);
    if (!run) return;

    this.activeRuns.delete(runId);

    this.backendRequest('PATCH', `/agent-runs/${runId}`, {
      status,
      completed_at: new Date().toISOString(),
      error: error || null,
      message_content: messageContent,
    }).catch(console.error);
  }

  private async fetchExpertName(expertId: string): Promise<ExpertNameLookup | null> {
    return this.backendGet<ExpertNameLookup>(`/experts/${expertId}`);
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
        res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
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
          res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
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
