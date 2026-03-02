/**
 * Shared types for the Cerebro agent system.
 */

// ── Model resolution ─────────────────────────────────────────────

export interface ResolvedModel {
  source: 'local' | 'cloud';
  provider?: string; // e.g. "anthropic", "openai", "google"
  modelId: string;
  displayName: string;
}

export interface ExpertModelConfig {
  source: 'local' | 'cloud';
  provider?: string | null;
  model_id: string;
  display_name: string;
}

// ── Tool context ────────────────────────────────────────────────

export interface ToolContext {
  expertId: string | null;
  conversationId: string;
  scope: string;
  scopeId: string | null;
  backendPort: number;
}

// ── Agent run request (from renderer) ───────────────────────────

export interface AgentRunRequest {
  conversationId: string;
  content: string;
  expertId?: string | null;
}

// ── Events sent to renderer ─────────────────────────────────────

export type RendererAgentEvent =
  | { type: 'run_start'; runId: string }
  | { type: 'turn_start'; turn: number }
  | { type: 'text_delta'; delta: string }
  | { type: 'tool_start'; toolCallId: string; toolName: string; args: unknown }
  | { type: 'tool_end'; toolCallId: string; toolName: string; result: string; isError: boolean }
  | { type: 'done'; runId: string; messageContent: string }
  | { type: 'error'; runId: string; error: string };

// ── Active run info ─────────────────────────────────────────────

export interface ActiveRunInfo {
  runId: string;
  conversationId: string;
  expertId: string | null;
  startedAt: number;
}
