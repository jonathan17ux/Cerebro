# Core Intelligence

## Problem Statement

Sections 1–6 of the roadmap built the infrastructure: an agent system that runs experts with scoped memory, a DAG execution engine, routines with cron scheduling, web search, and credential management. Each piece works. But there is no top-level coordinator tying them together. The user must manually select an expert before getting specialized help, manually create experts through a form, and cannot ask Cerebro to assemble a team or route a request to the right specialist. The infrastructure exists — the intelligence layer that orchestrates it does not.

Every leading multi-agent framework solves a version of this problem. OpenAI's Agents SDK introduced agent-as-tool and handoffs. Anthropic's research on orchestrator-worker patterns showed 90.2% improvement over single-agent approaches. LangGraph, CrewAI, AutoGen, and Google ADK each offer routing, sub-agent coordination, and fan-out/fan-in patterns. The common insight across all of them: LLM-based routing via tools outperforms rule-based classifiers because the router has full conversational context when deciding.

Core Intelligence is the orchestration layer. It makes three things possible that no existing framework offers together:

1. **Conversational expert creation.** Users describe a specialist they need in natural language. The LLM writes the system prompt, proposes it inline, and the user can preview and save — no code, no configuration files, no deployment. The LLM writes prompts for other LLM agents.

2. **Tool-based routing with zero configuration.** The expert catalog is injected into the system prompt. As users add experts, routing automatically improves. No classifiers to train, no routing rules to maintain, no code changes needed.

3. **Multi-strategy team orchestration.** Fan-out to multiple experts with parallel, sequential, or debate strategies — all through a single tool call, dynamically coordinated by the LLM based on the task and intermediate results.

## Design Principles

1. **The system prompt IS the router.** No separate classification layer. The LLM decides how to route based on the expert catalog in its context and the tools available to it. This follows the "agent-as-tool" pattern validated across OpenAI Agents SDK, Anthropic's research, and Google ADK — LLM-based routing consistently outperforms rule-based classifiers because the router has full conversational context.

2. **Experts don't delegate.** Only Cerebro (personal scope) has delegation and proposal tools. When a user is talking to an expert directly, that expert focuses on its domain. No inception-style delegation loops, no confused routing chains, no runaway sub-agent spawning.

3. **Proposals over automation.** Cerebro proposes experts and routines — it doesn't silently create them. The user reviews, previews, and saves. Same human-in-the-loop pattern used for routine proposals, extended to expert creation.

4. **Reuse what exists.** Expert delegation already works inside the execution engine (`src/engine/actions/expert-step.ts`). The memory system already assembles system prompts from multiple tiers (`backend/memory/recall.py`). Routine proposals already flow through tool → ChatContext → inline card → save. Core Intelligence extends these patterns rather than replacing them.

5. **Graceful degradation.** Zero experts configured? Cerebro responds directly and suggests creating one. Expert catalog fetch fails? Cerebro proceeds without it. Delegation times out? Cerebro apologizes and responds itself. The orchestration layer is additive — removing it returns Cerebro to its current behavior.

## Architecture Overview

```
User Message
       |
       v
ChatContext.sendMessage()
       | (IPC)
       v
AgentRuntime.startRun()
       |
       +-- scope == "personal" (no expert selected) -----> CEREBRO MODE
       |     |
       |     +-- System prompt assembled from:
       |     |     1. Identity & Role (static)
       |     |     2. Capabilities & Tools (static)
       |     |     3. Expert Catalog (dynamic -- top 20 by last_active_at)
       |     |     4. Routine Catalog (dynamic -- top 20 by last_run_at)
       |     |     5. Expert Proposal Guidance (static)
       |     |     6. Routine Proposal Guidance (static -- already exists)
       |     |     7. Memory tiers (dynamic -- profile, style, facts, knowledge)
       |     |     8. Conversation history + prior proposals (appended by runtime.ts)
       |     |
       |     +-- Tools: DEFAULT_TOOLS + CEREBRO_TOOLS
       |     |     delegate_to_expert   -- route to a specialist
       |     |     delegate_to_team     -- fan-out to team members
       |     |     propose_expert       -- create a new specialist
       |     |     list_experts         -- query the expert catalog
       |     |
       |     +-- LLM decides:
       |           respond directly | delegate | propose expert | propose routine | fan-out
       |
       +-- scope == "expert" (expert selected) ----------> EXPERT MODE (unchanged)
             |
             +-- Expert's system prompt + scoped memory
             +-- Expert's tool_access (no CEREBRO_TOOLS)
             +-- LLM responds within its domain
```

### Routing Decision Table

The system prompt gives Cerebro explicit guidance on when to use each capability:

| User Intent | Action | Tool |
|---|---|---|
| General question, small talk, memory management | Respond directly | (none) |
| Request matching an expert's domain | Delegate to expert | `delegate_to_expert` |
| Complex task needing multiple perspectives | Fan-out to team | `delegate_to_team` |
| Specialized domain with no matching expert | Propose new expert | `propose_expert` |
| Repeatable workflow | Propose routine | `propose_routine` (existing) |
| Run existing routine | Execute | `run_routine` (existing) |
| Ambiguous request | Ask clarifying question | (none) |

There is no separate classifier. The LLM has full conversational context when deciding, can combine routing with direct response (answer one part, delegate another), can ask clarifying questions before routing, and automatically improves as users add experts to the catalog.

### Data Flow: Delegation

```
Cerebro receives "Help me plan a marathon training schedule"
       |
       v
LLM sees "Fitness Coach [ID: abc123]" in expert catalog
       |
       v
LLM calls delegate_to_expert(expertId="abc123", task="...", context="...")
       |
       v
Tool composes prompt, calls agentRuntime.startRun() with synthetic conversationId
       |                                                    "delegate:{parentRunId}:{expertId}"
       v
Sub-agent runs autonomously (own system prompt, own tools, own memory scope)
       |
       +-- delegation_start event --> UI shows spinner: "Fitness Coach is working..."
       |
       v
Sub-agent completes --> delegation_end event --> UI shows checkmark
       |
       v
Tool returns expert's full response as tool result text
       |
       v
Cerebro synthesizes and presents to user
```

### Data Flow: Expert Proposal

```
User: "I need help managing my finances"
       |
       v
LLM sees no finance expert in catalog
       |
       v
LLM calls propose_expert(name="Personal Finance Advisor", systemPrompt="...", ...)
       |
       v
Tool checks for duplicate names (Jaccard similarity > 60%), returns JSON
       |
       v
ChatContext detects type: 'expert_proposal' in tool_end handler
       |
       v
ExpertProposalCard renders inline with Preview | Save | Dismiss
       |
       +-- Preview: temporary agent run with proposed config (previewConfig on AgentRunRequest)
       +-- Save: POST /experts + optional PUT /memory/context-files/expert:{newId}
       +-- Dismiss: status -> 'dismissed', persisted in message metadata
```

## System Prompt Assembly

### Current State

`BASE_SYSTEM_PROMPT` in `backend/memory/recall.py:11` is a single sentence:

```
You are Cerebro, a personal AI assistant. You are helpful, thoughtful, and concise.
You remember what the user tells you and use that context to provide better assistance over time.
```

No expert awareness, no routing instructions, no tool guidance, no capability description.

### Expanded Prompt Structure

The system prompt is assembled server-side by `assemble_system_prompt()` in `recall.py`. Two new boolean flags on `MemoryContextRequest` — `include_expert_catalog` and `include_routine_catalog` — control whether dynamic catalog sections are injected:

```python
class MemoryContextRequest(BaseModel):
    messages: list[dict] | None = None
    scope: str = "personal"
    scope_id: str | None = None
    include_expert_catalog: bool = False    # NEW
    include_routine_catalog: bool = False   # NEW
```

When `scope == "personal"`, `runtime.ts` passes both as `true`. When `scope == "expert"`, both are `false` — experts don't see the catalog and cannot delegate.

The assembled prompt follows this section order:

```
 1. ## Identity & Role              static    Who Cerebro is and what it can do
 2. ## Capabilities & Tools          static    Tool categories and when to use each
 3. ## Available Experts             dynamic   Top 20 enabled experts by last_active_at
 4. ## Available Routines            dynamic   Top 20 enabled routines by last_run_at
 5. ## Expert Proposal Guidance      static    When and how to propose new experts
 6. ## Routine Proposal Guidance     static    Already exists -- when and how to propose routines
 7. ## About the User                dynamic   Profile context file from settings table
 8. ## Communication Style           dynamic   Style context file from settings table
 9. ## What You Know                 dynamic   Top-K recalled facts by semantic similarity
10. ## Recent Activity & Records     dynamic   Knowledge entries (recent + relevant)
--- appended by runtime.ts: ---
11. ## Recent Conversation History              Last 10 messages, truncated to 500 chars each
12. ## Prior Routine Proposals                  Snapshot of routine proposals in this conversation
13. ## Prior Expert Proposals                   Snapshot of expert proposals in this conversation
```

### Expert Catalog Injection

When `include_expert_catalog` is true, `assemble_system_prompt()` queries the `Expert` table:

```python
experts = (
    db.query(Expert)
    .filter(Expert.is_enabled == True)
    .order_by(Expert.last_active_at.desc().nullslast())
    .limit(20)
    .all()
)
total = db.query(Expert).filter(Expert.is_enabled == True).count()
```

Formatted compactly to minimize token cost:

```
## Available Experts
- **Fitness Coach** [ID: abc123] (domain: health) -- Tracks workouts, suggests exercises, analyzes progress
- **Research Team** [ID: def456] (type: team, 3 members) -- Deep research with multi-perspective analysis
(Showing 2 of 2 experts. Use `list_experts` tool for full catalog.)
```

Edge cases:
- **Empty catalog**: "No experts configured yet. You can propose creating one with `propose_expert`."
- **20+ experts**: Shows top 20 by `last_active_at`, appends count note with `list_experts` guidance
- **Expert-scoped runs**: Catalog is never injected (experts do not delegate)

Same pattern for routines — top 20 by `last_run_at`, with `run_routine` guidance.

### Expert Proposal Guidance

A new static section, `EXPERT_PROPOSAL_GUIDANCE`, mirrors the existing `ROUTINE_PROPOSAL_GUIDANCE` constant. It teaches Cerebro when to propose experts and how to write effective system prompts:

```python
EXPERT_PROPOSAL_GUIDANCE = """## Expert Proposals

You can propose creating a new specialist expert using the `propose_expert` tool. \
Experts are persistent AI specialists with their own system prompt, memory, and tools.

### When to Propose

Only propose when the user shows CLEAR intent for specialized, recurring assistance:
- **Domain language:** "I need a coach for...", "help me with my finances", "track my workouts"
- **Specialization language:** "I want an expert in...", "can you be my..."
- **Explicit request:** "create an expert", "make a specialist for"

Do NOT propose when:
- The user is asking a one-off question you can answer directly
- An existing expert already covers this domain (suggest delegating instead)
- The request is too broad ("make me an expert for everything")

### Writing Expert System Prompts (Vibe Engineering)

When generating the expert's systemPrompt, include:
1. **Identity**: Who they are, their role, personality traits
2. **Capabilities**: What they can do with their available tools
3. **Style**: How they communicate (tone, format, length)
4. **Rules**: What they should always/never do
5. **Domain knowledge**: Key concepts, frameworks, and best practices

The prompt should be 200-500 words. Be specific -- vague prompts produce vague experts. \
Write in second person ("You are a...") as the prompt addresses the expert directly."""
```

### Files Modified

| File | Change |
|---|---|
| `backend/memory/recall.py` | Expand `BASE_SYSTEM_PROMPT`, add `EXPERT_PROPOSAL_GUIDANCE`, add expert/routine catalog injection to `assemble_system_prompt()` |
| `backend/memory/schemas.py` | Add `include_expert_catalog` and `include_routine_catalog` to `MemoryContextRequest` |
| `src/agents/runtime.ts` | Pass catalog flags when `scope == "personal"`, inject expert proposal snapshots alongside routine proposal snapshots |

## Delegation Tools

### `ToolContext` Extension

Delegation tools need access to `AgentRuntime` (to spawn sub-agents) and the parent run ID (for tracking and synthetic conversation IDs). Two fields are added to `ToolContext`:

```typescript
// src/agents/types.ts
export interface ToolContext {
  expertId: string | null;
  conversationId: string;
  scope: string;
  scopeId: string | null;
  backendPort: number;
  executionEngine?: ExecutionEngine;
  webContents?: WebContents;
  agentRuntime?: AgentRuntime;    // NEW -- for delegation tools
  parentRunId?: string;            // NEW -- for nesting context
}
```

`runtime.ts` passes `agentRuntime: this` and `parentRunId: runId` into the tool context when building tools.

### Shared Sub-Agent Helper

`src/engine/actions/expert-step.ts` already implements the pattern: start an agent run, listen for events on the IPC channel, collect results, return. Rather than duplicating this, a shared helper is extracted:

```typescript
// src/agents/tools/delegation-tools.ts

interface SubAgentResult {
  response: string;
  toolsUsed: string[];
  turns: number;
  agentRunId: string;
}

async function runSubAgent(
  agentRuntime: AgentRuntime,
  webContents: WebContents,
  conversationId: string,
  prompt: string,
  expertId?: string,
): Promise<SubAgentResult> {
  const agentRunId = await agentRuntime.startRun(webContents, {
    conversationId,
    content: prompt,
    expertId: expertId ?? null,
  });

  return new Promise((resolve, reject) => {
    const channel = `agent:event:${agentRunId}`;
    const toolsUsed = new Set<string>();
    let turns = 0;

    const handler = (_ipcEvent: unknown, event: RendererAgentEvent) => {
      switch (event.type) {
        case 'turn_start':
          turns = event.turn;
          break;
        case 'tool_start':
          toolsUsed.add(event.toolName);
          break;
        case 'done':
          cleanup();
          resolve({
            response: event.messageContent,
            toolsUsed: Array.from(toolsUsed),
            turns,
            agentRunId,
          });
          break;
        case 'error':
          cleanup();
          reject(new Error(event.error));
          break;
      }
    };

    const cleanup = () => {
      webContents.ipc.removeListener(channel, handler);
    };

    webContents.ipc.on(channel, handler);

    // 5 minute timeout
    setTimeout(() => {
      cleanup();
      reject(new Error('Delegation timed out after 5 minutes'));
    }, 5 * 60 * 1000);
  });
}
```

This is functionally identical to `collectAgentResults()` in `expert-step.ts`. Once both are using the same helper, the duplication in `expert-step.ts` can be removed.

### `delegate_to_expert`

The core delegation primitive. Spawns a sub-agent for a specific expert and returns its complete response as the tool result.

```typescript
// src/agents/tools/delegation-tools.ts

export function createDelegateToExpert(ctx: ToolContext): AgentTool {
  return {
    name: 'delegate_to_expert',
    description:
      'Delegate a task to a specialist expert who will work autonomously using their ' +
      'own tools and knowledge. The expert cannot see the full conversation -- provide ' +
      'a clear, complete task description with any relevant context.',
    label: 'Delegate to Expert',
    parameters: Type.Object({
      expertId: Type.String({
        description: 'Expert ID from the expert catalog in your system prompt',
      }),
      task: Type.String({
        description: 'Clear, complete task description for the expert',
      }),
      context: Type.Optional(
        Type.String({
          description: 'Relevant conversation context the expert needs to know',
        }),
      ),
    }),
    execute: async (_toolCallId, params) => {
      if (!ctx.agentRuntime || !ctx.webContents) {
        return textResult('Agent runtime is not available. Try again in a moment.');
      }

      // Compose the prompt
      const prompt = params.context
        ? `${params.context}\n\n${params.task}`
        : params.task;

      // Synthetic conversation ID to avoid polluting user's chat history
      const delegationConvId = `delegate:${ctx.parentRunId}:${params.expertId}`;

      // Emit delegation_start event on the parent channel
      const parentChannel = `agent:event:${ctx.parentRunId}`;
      let expertName = params.expertId; // fallback
      try {
        const expert = await backendRequest<{ name: string }>(
          ctx.backendPort, 'GET', `/experts/${params.expertId}`,
        );
        expertName = expert.name;
      } catch { /* use ID as fallback */ }

      try {
        const result = await runSubAgent(
          ctx.agentRuntime,
          ctx.webContents,
          delegationConvId,
          prompt,
          params.expertId,
        );
        return textResult(result.response);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return textResult(`Expert delegation failed: ${msg}`);
      }
    },
  };
}
```

**Sub-agent streaming**: Summary mode. The sub-agent's individual `text_delta` events are NOT forwarded to the UI during delegation. The parent channel receives `delegation_start` and `delegation_end` events, which render as a `DelegationStatusCard` — spinner while working, checkmark when done.

### `list_experts`

A simple read-only tool that queries the expert catalog. Useful when the system prompt's top-20 truncation omits relevant experts, or when the LLM needs to search by domain or name.

```typescript
export function createListExperts(ctx: ToolContext): AgentTool {
  return {
    name: 'list_experts',
    description: 'Search and list available experts and teams.',
    label: 'List Experts',
    parameters: Type.Object({
      type: Type.Optional(
        Type.Union([Type.Literal('expert'), Type.Literal('team')], {
          description: 'Filter by expert or team type',
        }),
      ),
      search: Type.Optional(
        Type.String({ description: 'Search query to filter by name or description' }),
      ),
    }),
    execute: async (_toolCallId, params) => {
      const queryParts = ['is_enabled=true'];
      if (params.type) queryParts.push(`type=${params.type}`);
      if (params.search) queryParts.push(`search=${encodeURIComponent(params.search)}`);

      try {
        const res = await backendRequest<{ experts: Array<{ id: string; name: string; domain: string | null; description: string; type: string }> }>(
          ctx.backendPort, 'GET', `/experts?${queryParts.join('&')}`,
        );
        if (res.experts.length === 0) {
          return textResult('No experts found matching your query.');
        }
        const lines = res.experts.map(
          (e) => `- **${e.name}** [ID: ${e.id}] (${e.type}${e.domain ? `, domain: ${e.domain}` : ''}) -- ${e.description}`,
        );
        return textResult(lines.join('\n'));
      } catch (err) {
        return textResult(`Failed to list experts: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  };
}
```

### Tool Registry

The tool registry (`src/agents/tools/index.ts`) gains a `CEREBRO_TOOLS` list and scope-aware filtering:

```typescript
import {
  createDelegateToExpert,
  createDelegateToTeam,
  createListExperts,
} from './delegation-tools';
import { createProposeExpert } from './expert-proposal-tools';

const CEREBRO_TOOLS = [
  'delegate_to_expert',
  'delegate_to_team',
  'propose_expert',
  'list_experts',
];

const TOOL_FACTORIES: Record<string, (ctx: ToolContext) => AgentTool> = {
  // ... existing tools ...
  delegate_to_expert: createDelegateToExpert,
  delegate_to_team: createDelegateToTeam,
  propose_expert: createProposeExpert,
  list_experts: createListExperts,
};

export function createToolsForExpert(
  ctx: ToolContext,
  toolAccess?: string[] | null,
): AgentTool[] {
  let toolNames = toolAccess && toolAccess.length > 0 ? toolAccess : DEFAULT_TOOLS;

  // In Cerebro mode (no expert selected), add orchestration tools
  // In expert mode, exclude them -- experts don't delegate
  if (!ctx.expertId) {
    toolNames = [...toolNames, ...CEREBRO_TOOLS];
  } else {
    toolNames = toolNames.filter((name) => !CEREBRO_TOOLS.includes(name));
  }

  const tools: AgentTool[] = [];
  for (const name of toolNames) {
    const factory = TOOL_FACTORIES[name];
    if (factory) tools.push(factory(ctx));
  }
  return tools;
}
```

### Delegation Event Types

New event types for the `RendererAgentEvent` union in `src/agents/types.ts`:

```typescript
export type RendererAgentEvent =
  | { type: 'run_start'; runId: string }
  | { type: 'turn_start'; turn: number }
  | { type: 'text_delta'; delta: string }
  | { type: 'tool_start'; toolCallId: string; toolName: string; args: unknown }
  | { type: 'tool_end'; toolCallId: string; toolName: string; result: string; isError: boolean }
  | { type: 'done'; runId: string; messageContent: string }
  | { type: 'error'; runId: string; error: string }
  // NEW -- delegation lifecycle events
  | { type: 'delegation_start'; expertId: string; expertName: string; subRunId: string }
  | { type: 'delegation_end'; expertId: string; expertName: string; subRunId: string; summary: string; isError: boolean }
  | { type: 'team_progress'; teamId: string; completedMembers: number; totalMembers: number };
```

### Parent-Child Run Tracking

A `parent_run_id` column on `AgentRun` links sub-agent runs to their parent:

```python
# backend/models.py -- add to AgentRun
parent_run_id: Mapped[str | None] = mapped_column(
    String(32), ForeignKey("agent_runs.id", ondelete="SET NULL"), nullable=True
)
```

```python
# backend/agent_runs/schemas.py -- add to AgentRunCreate and AgentRunResponse
parent_run_id: str | None = None
```

```python
# backend/agent_runs/router.py -- pass through in create endpoint
run = AgentRun(
    id=body.id or _uuid_hex(),
    expert_id=body.expert_id,
    conversation_id=body.conversation_id,
    parent_run_id=body.parent_run_id,    # NEW
    status=body.status,
)
```

Sub-runs use synthetic conversation IDs — `delegate:{parentRunId}:{expertId}` — to avoid polluting the user's conversation history while maintaining traceability. The `parent_run_id` enables:

- **Activity screen**: Render run hierarchies (Cerebro run → expert sub-runs)
- **Metrics**: Track delegation depth and frequency across conversations
- **Debugging**: Trace from any sub-run back to the parent conversation

## Expert Proposal Flow

### Pattern

Expert proposals follow the exact same pattern as routine proposals — the infrastructure is already proven:

1. `propose_expert` tool validates and returns JSON with `type: 'expert_proposal'`
2. `ChatContext` detects it in the `tool_end` event handler
3. `ExpertProposalCard` renders inline in the message
4. User can Preview, Save, or Dismiss
5. State persists in message metadata across app restarts

### `propose_expert` Tool

```typescript
// src/agents/tools/expert-proposal-tools.ts

export function createProposeExpert(ctx: ToolContext): AgentTool {
  return {
    name: 'propose_expert',
    description:
      'Propose creating a new specialist expert. The proposal renders inline ' +
      'for the user to preview, save, or dismiss. Write a detailed system prompt ' +
      'that defines the expert\'s personality, capabilities, and behavioral rules.',
    label: 'Propose Expert',
    parameters: Type.Object({
      name: Type.String({
        description: 'Short, descriptive name (e.g. "Fitness Coach", "Personal CFO")',
      }),
      description: Type.String({
        description: 'One or two sentence summary of what this expert does',
      }),
      domain: Type.Optional(
        Type.String({ description: 'Domain tag (e.g. "health", "finance", "writing")' }),
      ),
      system_prompt: Type.String({
        description: 'Full system prompt for the expert (200-500 words). ' +
          'Include identity, capabilities, communication style, rules, and domain knowledge.',
      }),
      tool_access: Type.Optional(
        Type.Array(Type.String(), {
          description: 'Tool names the expert should have access to. Defaults to all standard tools.',
        }),
      ),
      suggested_context_file: Type.Optional(
        Type.String({
          description: 'Suggested markdown content for the expert\'s context file, ' +
            'with placeholder sections the user should fill in.',
        }),
      ),
    }),
    execute: async (_toolCallId, params) => {
      // Check for duplicate experts
      try {
        const res = await backendRequest<{ experts: Array<{ id: string; name: string }> }>(
          ctx.backendPort, 'GET', `/experts?search=${encodeURIComponent(params.name)}&is_enabled=true`,
        );
        const duplicate = res.experts.find((e) => isSimilarName(e.name, params.name));
        if (duplicate) {
          return textResult(
            `A similar expert already exists: "${duplicate.name}" (ID: ${duplicate.id}). ` +
            `Suggest delegating to them or ask the user if they want to modify the existing expert.`,
          );
        }
      } catch { /* proceed if backend unreachable */ }

      const proposal = {
        type: 'expert_proposal',
        name: params.name,
        description: params.description,
        domain: params.domain ?? null,
        systemPrompt: params.system_prompt,
        toolAccess: params.tool_access ?? null,
        suggestedContextFile: params.suggested_context_file ?? null,
      };
      return textResult(JSON.stringify(proposal));
    },
  };
}
```

The `isSimilarName()` function is the same Jaccard similarity check from `routine-tools.ts` (threshold > 60% token overlap). It can be extracted to `tool-utils.ts` to avoid duplication.

### Frontend Types

```typescript
// src/types/chat.ts -- add alongside existing RoutineProposal

export interface ExpertProposal {
  name: string;
  description: string;
  domain: string | null;
  systemPrompt: string;
  toolAccess: string[] | null;
  suggestedContextFile: string | null;
  status: 'proposed' | 'previewing' | 'saved' | 'dismissed';
  savedExpertId?: string;
}

// Add to Message interface:
expertProposal?: ExpertProposal;
```

```typescript
// src/agents/types.ts -- add alongside existing ProposalSnapshot

export interface ExpertProposalSnapshot {
  name: string;
  status: 'proposed' | 'previewing' | 'saved' | 'dismissed';
}

// Add to AgentRunRequest:
expertProposals?: ExpertProposalSnapshot[];
```

### ChatContext Integration

Two changes to `src/context/ChatContext.tsx`:

**Detection** — In the `tool_end` event handler, after the existing `propose_routine` detection (line ~404):

```typescript
// Detect propose_expert tool result and attach proposal to message
if (event.toolName === 'propose_expert' && !event.isError) {
  try {
    const parsed = JSON.parse(event.result);
    if (parsed.type === 'expert_proposal') {
      accExpertProposal = {
        name: parsed.name,
        description: parsed.description,
        domain: parsed.domain,
        systemPrompt: parsed.systemPrompt,
        toolAccess: parsed.toolAccess,
        suggestedContextFile: parsed.suggestedContextFile,
        status: 'proposed',
      };
      updateMessage(convId!, assistantId, { expertProposal: accExpertProposal });
    }
  } catch { /* not valid JSON, treat as normal result */ }
}
```

**Snapshot collection** — In `sendMessage()`, after routineProposals collection (line ~335):

```typescript
const expertProposals = allMessages
  .filter((m) => m.expertProposal)
  .map((m) => ({
    name: m.expertProposal!.name,
    status: m.expertProposal!.status,
  }));
```

Passed to `window.cerebro.agent.run()` alongside `routineProposals`.

**Persistence** — On `done`, expert proposals are serialized to message metadata using the same `toApiExpertProposal()` helper pattern as `toApiProposal()` in `chat-helpers.ts`.

### ExpertProposalCard Component

`src/components/chat/ExpertProposalCard.tsx` — mirrors `RoutineProposalCard` styling and interaction pattern:

```
+-----------------------------------------------+
| [Brain icon]  Personal Finance Advisor  [Proposed] |
+-----------------------------------------------+
| Tracks spending, analyzes budgets, provides    |
| financial coaching and investment guidance.    |
+-----------------------------------------------+
| Domain: finance                                |
+-----------------------------------------------+
| System Prompt                           [Show] |
| You are a personal finance advisor...          |
| (first 3 lines visible, expandable)            |
+-----------------------------------------------+
| Tools: recall_facts, save_entry, web_search    |
+-----------------------------------------------+
| [Preview]  [Save Expert]           [Dismiss]   |
+-----------------------------------------------+
```

**Preview**: Adds `previewConfig?: { systemPrompt: string; toolAccess: string[] }` to `AgentRunRequest`. When set, `runtime.ts` uses the preview config instead of fetching from the backend's `/experts/{id}` endpoint. The user can test-drive the expert in the current conversation before committing.

**Save**:
1. `POST /experts` with proposal data mapped to `ExpertCreate` schema
2. If `suggestedContextFile` is present: `PUT /memory/context-files/expert:{newId}` to seed the expert's context file
3. Update proposal status to `'saved'`, store `savedExpertId`
4. Refresh expert list in `ExpertContext`

**Dismiss**: Update status to `'dismissed'`, persist in metadata. The `EXPERT_PROPOSAL_GUIDANCE` in the system prompt tells Cerebro not to re-propose dismissed experts.

### ChatMessage Rendering

`src/components/chat/ChatMessage.tsx` adds the expert proposal card alongside the existing routine proposal card:

```tsx
{/* Expert proposal card */}
{!isUser && message.expertProposal && (
  <div className="mb-2">
    <ExpertProposalCard
      proposal={message.expertProposal}
      messageId={message.id}
      conversationId={message.conversationId}
    />
  </div>
)}
```

## Team Orchestration

### Architecture Decision

Teams use the **agent-as-tool pattern**, not the DAG executor. This is a deliberate choice:

- **DAGs** are for static, repeatable routines with predetermined step order and outputs. They compile once and run identically each time.
- **Teams** need dynamic coordination — the coordinator adapts based on sub-agent results, can re-route on partial failures, and produces different synthesis depending on what each member contributes.

The `delegate_to_team` tool handles all coordination logic imperatively. Three strategies are available:

### Data Model

The data model already exists: an `Expert` with `type: 'team'` and `team_members: [{expert_id, role, order}]` (defined in `backend/experts/schemas.py:14`). No schema changes needed.

### `delegate_to_team` Tool

```typescript
export function createDelegateToTeam(ctx: ToolContext): AgentTool {
  return {
    name: 'delegate_to_team',
    description:
      'Delegate a task to a team of experts who work together. ' +
      'Supports parallel (all at once), sequential (chain output), ' +
      'and debate (argue then synthesize) strategies.',
    label: 'Delegate to Team',
    parameters: Type.Object({
      teamId: Type.String({ description: 'Team expert ID' }),
      task: Type.String({ description: 'Task description' }),
      context: Type.Optional(Type.String({ description: 'Relevant context' })),
      strategy: Type.Optional(
        Type.Union(
          [Type.Literal('parallel'), Type.Literal('sequential'), Type.Literal('debate')],
          { description: 'Execution strategy. Default: parallel.' },
        ),
      ),
    }),
    execute: async (_toolCallId, params) => {
      // implementation dispatches to strategy handler
    },
  };
}
```

### Parallel Strategy (Fan-Out / Fan-In)

1. Fetch team definition: `GET /experts/{teamId}` → parse `team_members` JSON
2. Resolve each member: `GET /experts/{memberId}` → get name, ID
3. Spawn all sub-agents concurrently:
   ```typescript
   const results = await Promise.allSettled(
     members.map((m) =>
       runSubAgent(agentRuntime, webContents, `delegate:${parentRunId}:${m.expert_id}`, prompt, m.expert_id)
     ),
   );
   ```
4. Collect successful results, note failures
5. Synthesize via a single-shot model call through the backend's streaming endpoints:
   ```
   You are synthesizing responses from multiple expert perspectives on the following task.
   Combine their insights, resolve any contradictions, and produce a single coherent response.
   Attribute key points to the relevant expert when helpful.

   Task: {task}

   --- Fitness Coach ---
   {response1}

   --- Nutritionist ---
   {response2}
   ```
6. Return synthesized result as tool output

**Partial failure**: If some members fail, synthesize from successful ones. Only fail the entire delegation if ALL members fail.

### Sequential Strategy

Members are chained in their `order` field. Each receives the previous member's output as additional context:

```typescript
let chainContext = params.context ?? '';
for (const member of sortedMembers) {
  const result = await runSubAgent(..., `${chainContext}\n\n${params.task}`, member.expert_id);
  chainContext = `Previous expert (${member.role}) responded:\n${result.response}`;
}
```

The final member's output is the result. Useful for review chains: draft → critique → polish.

### Debate Strategy

Two rounds:

1. **Round 1**: All members respond independently (parallel fan-out)
2. **Round 2**: Each member receives all other members' responses and provides a critique/revision
3. **Synthesis**: All Round 1 and Round 2 responses are synthesized into a final answer

This produces higher-quality outputs for contested topics by forcing experts to engage with opposing perspectives.

### Delegation UI

`src/components/chat/DelegationStatusCard.tsx` — a lightweight inline component, NOT a full `ToolCallCard`:

```
During delegation:
+------------------------------------------+
| [spinner]  Fitness Coach is working...   |
+------------------------------------------+

After completion:
+------------------------------------------+
| [checkmark]  Fitness Coach responded     |
|  [Show full response]                    |
+------------------------------------------+

Team progress:
+------------------------------------------+
| [progress]  Research Team  2/3 complete  |
+------------------------------------------+
```

`ChatContext` handles `delegation_start`, `delegation_end`, and `team_progress` events and renders `DelegationStatusCard` elements inline. These are visual-only — the actual tool result flows through the normal `tool_end` event.

### Timeout and Error Handling

| Scenario | Behavior |
|---|---|
| Single expert timeout (5 min) | `runSubAgent` rejects, tool returns error message |
| Team member timeout | Exclude from synthesis, note partial results |
| All team members fail | Return error to Cerebro, which apologizes and may offer to try individually |
| Parent run cancelled | Cancel all active sub-agent runs via `agentRuntime.cancelRun()` |
| Expert not found | Return error from `runSubAgent` before spawning |

## Key Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Routing approach | LLM-based via tools, no classifier | Full conversational context, zero maintenance, auto-improves with catalog growth. Validated by OpenAI, Anthropic, and Google ADK research. |
| Catalog injection | Top-20 in system prompt | Token-efficient, sorted by recency, with `list_experts` fallback for large catalogs. |
| Expert proposal pattern | Same as routine proposals | Proven UX (propose → preview → save), reuses ChatContext/metadata infrastructure. |
| Team execution model | Agent-as-tool, not DAG | Teams need dynamic coordination; DAGs are for static, repeatable workflows. |
| Sub-agent conversation IDs | Synthetic `delegate:{parent}:{expert}` | Prevents pollution of user chat history while maintaining traceability. |
| Sub-agent streaming | Summary mode (spinner + result) | Forwarding sub-agent text deltas to the UI creates confusing interleaved output. |
| System prompt expansion | Server-side, behind feature flags | Catalog queries require DB access; flags let expert-scoped runs skip the cost. |
| Duplicate detection | Jaccard similarity > 60% | Same proven approach from routine proposals, prevents redundant experts. |
| Team synthesis | Single-shot model call | Synthesis is a formatting task, not a multi-turn reasoning task — a full agent loop would be wasteful. |
| Parent-child tracking | `parent_run_id` FK on `AgentRun` | Lightweight, enables activity UI, metrics, and debugging without schema complexity. |

## Implementation Phases

Each phase delivers a working increment that can be tested independently.

### Phase 1: System Prompt + Routing Foundation

1. Expand `BASE_SYSTEM_PROMPT` in `recall.py` with Identity & Role, Capabilities & Tools, routing guidance
2. Add `EXPERT_PROPOSAL_GUIDANCE` constant to `recall.py`
3. Add expert/routine catalog injection to `assemble_system_prompt()` (guarded by new boolean flags)
4. Add `include_expert_catalog` / `include_routine_catalog` to `MemoryContextRequest` in `schemas.py`
5. Update `runtime.ts` to pass catalog flags when `scope == "personal"`

**Deliverable**: Cerebro's system prompt includes the full expert catalog and routing instructions. LLM can reason about experts even before delegation tools exist.

### Phase 2: Delegation Tools + Run Tracking

6. Add `agentRuntime` and `parentRunId` to `ToolContext` in `types.ts`
7. Update `runtime.ts` to pass `agentRuntime: this` and `parentRunId: runId` into tool context
8. Create `src/agents/tools/delegation-tools.ts` with `runSubAgent()` helper, `delegate_to_expert`, and `list_experts`
9. Add `parent_run_id` to `AgentRun` model, agent run schemas, and router
10. Register new tools in `index.ts` with `CEREBRO_TOOLS` scope filtering
11. Add `delegation_start`, `delegation_end`, `team_progress` event types to `RendererAgentEvent`

**Deliverable**: Cerebro can delegate tasks to individual experts and return their responses. Sub-runs are tracked with parent linkage.

### Phase 3: Expert Proposals

12. Create `src/agents/tools/expert-proposal-tools.ts` with `propose_expert`
13. Add `ExpertProposal` type to `chat.ts`, `ExpertProposalSnapshot` to `types.ts`
14. Add expert proposal detection to `ChatContext.tsx` `tool_end` handler
15. Add expert proposal snapshot collection to `sendMessage()` flow
16. Add expert proposal serialization helpers to `chat-helpers.ts`
17. Create `src/components/chat/ExpertProposalCard.tsx`
18. Update `ChatMessage.tsx` to render `ExpertProposalCard`
19. Implement save flow (POST /experts + optional context file)
20. Implement preview mode (`previewConfig` on `AgentRunRequest`, handled in `runtime.ts`)

**Deliverable**: Cerebro proposes new experts via conversation. Users can preview, save, and immediately use them.

### Phase 4: Team Orchestration

21. Implement `delegate_to_team` tool with parallel strategy and synthesis
22. Create `src/components/chat/DelegationStatusCard.tsx`
23. Update `ChatContext.tsx` to handle delegation events and render status cards
24. Add sequential and debate strategies to `delegate_to_team`

**Deliverable**: Teams of experts can be coordinated through a single tool call with multiple execution strategies.

### Phase 5: Polish + Testing

25. End-to-end: user message → Cerebro routes → expert responds → result synthesized
26. Expert proposal: propose → preview → save → delegate to the new expert
27. Team: create team → delegate → fan-out → synthesize
28. Edge cases: empty catalog, 50+ experts, delegation timeout, partial team failure, nested delegation prevention

## Files Summary

### Files Created

| File | Purpose |
|---|---|
| `src/agents/tools/delegation-tools.ts` | `delegate_to_expert`, `delegate_to_team`, `list_experts`, `runSubAgent` helper |
| `src/agents/tools/expert-proposal-tools.ts` | `propose_expert` tool |
| `src/components/chat/ExpertProposalCard.tsx` | Inline expert proposal card (preview/save/dismiss) |
| `src/components/chat/DelegationStatusCard.tsx` | Delegation progress indicator (spinner/checkmark) |

### Files Modified

| File | Change |
|---|---|
| `backend/memory/recall.py` | Expand `BASE_SYSTEM_PROMPT`, add `EXPERT_PROPOSAL_GUIDANCE`, add catalog injection |
| `backend/memory/schemas.py` | Add `include_expert_catalog`, `include_routine_catalog` to `MemoryContextRequest` |
| `backend/models.py` | Add `parent_run_id` to `AgentRun` |
| `backend/agent_runs/schemas.py` | Add `parent_run_id` to create/response schemas |
| `backend/agent_runs/router.py` | Pass through `parent_run_id` in create endpoint |
| `src/agents/types.ts` | Extend `ToolContext`, add delegation events, add `ExpertProposalSnapshot` |
| `src/agents/runtime.ts` | Pass catalog flags, `agentRuntime`, `parentRunId`, expert proposal snapshots |
| `src/agents/tools/index.ts` | Register new tools, add `CEREBRO_TOOLS` scope filtering |
| `src/types/chat.ts` | Add `ExpertProposal` interface, add `expertProposal` to `Message` |
| `src/context/ChatContext.tsx` | Detect expert proposals in `tool_end`, collect snapshots, handle delegation events |
| `src/context/chat-helpers.ts` | Add expert proposal serialization/deserialization helpers |
| `src/components/chat/ChatMessage.tsx` | Render `ExpertProposalCard` and `DelegationStatusCard` |

## Verification

1. **System prompt**: Start a chat with no expert selected. Inspect the system prompt via backend logs. Verify it includes the expert catalog, routing guidance, and tool descriptions.

2. **Routing**: Create a Fitness Coach expert. Ask "help me plan a workout." Cerebro should call `delegate_to_expert`, the sub-agent should respond, and Cerebro should present the result to the user.

3. **Direct response**: Ask "what time is it." Cerebro should answer directly without delegating.

4. **Expert proposal**: Ask "I need help managing my finances" when no finance expert exists. Cerebro should call `propose_expert`. `ExpertProposalCard` should render inline. Preview should work. Save should create the expert in the database.

5. **Team delegation**: Create a team with multiple members. Ask a complex research question. `delegate_to_team` should fan out to all members. Results should be synthesized. `DelegationStatusCards` should show progress.

6. **Run tracking**: After a delegation, check the `agent_runs` table. The sub-run's `parent_run_id` should point to the Cerebro run. The sub-run's `conversation_id` should be the synthetic `delegate:{parent}:{expert}` format.

7. **Edge cases**: Empty expert catalog (Cerebro suggests creating one). 50+ experts (catalog truncation with `list_experts` guidance). Delegation timeout (5 minutes, graceful error). Expert that errors during delegation (Cerebro reports the failure). Partial team failure (synthesis from successful members).
