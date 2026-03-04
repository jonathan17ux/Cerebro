"""System prompt assembly from all three memory tiers."""

from __future__ import annotations

from sqlalchemy.orm import Session

from models import Expert, KnowledgeEntry, MemoryItem, Setting

from .schemas import MemoryContextResponse

BASE_SYSTEM_PROMPT = """You are Cerebro, a personal AI assistant. You are helpful, thoughtful, and concise. You remember what the user tells you and use that context to provide better assistance over time."""

ROUTINE_PROPOSAL_GUIDANCE = """## Routine Proposals

You can propose saving a repeatable task as a routine using the `propose_routine` tool. \
Routines are saved workflows that the user can run on demand or on a schedule.

### When to Propose

Only propose a routine when the user shows CLEAR repeatable intent — at least one of:
- **Scheduling language:** "every morning", "weekly on Mondays", "daily at 9am", "after each meeting"
- **Automation language:** "automatically do X", "I want it to always", "set up", "automate"
- **Explicit request:** "create a routine", "save this as a routine", "make this repeatable"

Do NOT propose a routine when:
- The user is asking a one-off question or having a conversation
- The task has no recurring element (even if it has multiple steps — "first install Node, then run tests" is NOT a routine)
- The user just dismissed a similar proposal
- The task is simple enough to just execute directly
- A similar routine already exists (the tool will tell you — suggest running or editing the existing one instead)

### Clarify Before Proposing

If the user's intent is clear but the details are vague, ASK before proposing. \
Don't guess at steps — ask what they actually want automated.

Example — user says "I want a morning routine":
- BAD: Immediately propose a routine with guessed steps like "Check email, review calendar, etc."
- GOOD: "What does your ideal morning prep look like? I can set up a routine for the parts you want automated."

Only propose immediately when the user gives you enough detail to write concrete, actionable steps. \
Explicit requests like "create a routine that searches for AI news and summarizes it" have enough detail.

### Do It Now AND Propose

When the user asks for something repeatable and it can also be done right now, do BOTH:
1. Execute the task immediately (search, draft, summarize — whatever is asked)
2. Then propose the routine so they can save it for next time

Example: "Search for AI news every morning" → do the search now, then propose a daily routine.

### Writing Good Steps

Each step should be a single, concrete action. Aim for 3-7 steps.
- GOOD: "Search the web for the latest AI news from the past 24 hours"
- BAD: "Handle the news gathering process" (too vague)
- BAD: "Open the search engine" (too granular — that's part of searching, not a step)

### Trigger Types and Cron

- Use `manual` (default) when the user wants to run on demand or didn't mention scheduling
- Use `cron` when the user specifies a schedule — you MUST include a valid cron expression:
  - `0 9 * * 1-5` = weekdays at 9am
  - `0 9 * * *` = every day at 9am
  - `0 */2 * * *` = every 2 hours
  - `0 9 * * 1` = every Monday at 9am
  - Format: `minute hour day-of-month month day-of-week` (5 fields, no seconds)

### Approval Gates

Mark steps that have side effects the user should review before executing:
- Sending emails or messages
- Modifying calendars or documents
- Making purchases or transactions
- Posting to social media
Do NOT mark read-only steps (searching, summarizing, drafting) as approval gates.

### Available Capabilities

Steps can currently use: web search, model calls (summarize, draft, analyze), and expert delegation. \
Connectors like Google Calendar, Gmail, and Notion are NOT yet available — do not propose \
steps that require them unless the user explicitly asks (in which case, list them in \
`required_connections` so the user knows what's needed)."""


async def recall_relevant(
    query: str,
    scope: str,
    scope_id: str | None,
    db: Session,
    top_k: int = 10,
) -> list[MemoryItem]:
    """Return top-K learned facts by semantic similarity to the query."""
    from .embeddings import get_embedder

    embedder = get_embedder()

    # Fetch all items for this scope
    q = db.query(MemoryItem).filter(MemoryItem.scope == scope)
    if scope_id:
        q = q.filter(MemoryItem.scope_id == scope_id)
    else:
        q = q.filter(MemoryItem.scope_id.is_(None))

    items = q.all()
    if not items:
        return []

    # Compute query embedding
    query_vec = embedder.embed(query)

    # Score candidates
    scored: list[tuple[float, MemoryItem]] = []
    for item in items:
        if item.embedding is None:
            continue
        import numpy as np
        candidate = np.frombuffer(item.embedding, dtype=np.float32)
        sim = float(np.dot(query_vec, candidate) / (
            np.linalg.norm(query_vec) * np.linalg.norm(candidate) + 1e-8
        ))
        scored.append((sim, item))

    # Sort by similarity descending
    scored.sort(key=lambda x: x[0], reverse=True)
    return [item for _, item in scored[:top_k]]


async def recall_knowledge(
    recent_messages: list[dict] | None,
    scope: str,
    scope_id: str | None,
    db: Session,
    recent_count: int = 15,
    relevant_count: int = 5,
) -> tuple[str | None, int]:
    """Retrieve recent + relevant knowledge entries, return formatted timeline and count."""
    # 1. Get most recent entries by occurred_at
    q = db.query(KnowledgeEntry).filter(KnowledgeEntry.scope == scope)
    if scope_id:
        q = q.filter(KnowledgeEntry.scope_id == scope_id)
    else:
        q = q.filter(KnowledgeEntry.scope_id.is_(None))

    recent = q.order_by(KnowledgeEntry.occurred_at.desc()).limit(recent_count).all()

    # 2. Get semantically relevant older entries
    relevant: list[KnowledgeEntry] = []
    if recent_messages:
        from .embeddings import get_embedder
        import numpy as np

        embedder = get_embedder()
        query_text = " ".join(m.get("content", "") for m in recent_messages[-3:])
        query_vec = embedder.embed(query_text)

        # Search all entries with embeddings
        all_entries = q.filter(KnowledgeEntry.embedding.isnot(None)).all()
        scored: list[tuple[float, KnowledgeEntry]] = []
        recent_ids = {e.id for e in recent}
        for entry in all_entries:
            if entry.id in recent_ids:
                continue
            candidate = np.frombuffer(entry.embedding, dtype=np.float32)
            sim = float(np.dot(query_vec, candidate) / (
                np.linalg.norm(query_vec) * np.linalg.norm(candidate) + 1e-8
            ))
            scored.append((sim, entry))
        scored.sort(key=lambda x: x[0], reverse=True)
        relevant = [e for _, e in scored[:relevant_count]]

    # 3. Merge, deduplicate, sort chronologically
    seen_ids: set[str] = set()
    all_entries_list: list[KnowledgeEntry] = []
    for entry in recent + relevant:
        if entry.id not in seen_ids:
            seen_ids.add(entry.id)
            all_entries_list.append(entry)

    all_entries_list.sort(key=lambda e: e.occurred_at)

    if not all_entries_list:
        return None, 0

    # 4. Format as timeline
    lines = []
    for entry in all_entries_list:
        date_str = entry.occurred_at.strftime("%b %d")
        lines.append(f"- [{date_str}] {entry.summary}")

    return "\n".join(lines), len(all_entries_list)


async def assemble_system_prompt(
    recent_messages: list[dict] | None,
    scope: str,
    scope_id: str | None,
    db: Session,
) -> MemoryContextResponse:
    """Assemble full system prompt from all three memory tiers."""
    sections: list[str] = []
    context_files_used: list[str] = []

    # 1. Base personality — use expert's system_prompt when expert-scoped
    if scope == "expert" and scope_id:
        expert = db.get(Expert, scope_id)
        if expert and expert.system_prompt:
            sections.append(expert.system_prompt)
        else:
            sections.append(BASE_SYSTEM_PROMPT)
    else:
        sections.append(BASE_SYSTEM_PROMPT)

    # 2. Routine proposal guidance (only for Cerebro, not individual experts)
    if scope != "expert":
        sections.append(ROUTINE_PROPOSAL_GUIDANCE)

    # 3. Profile context file
    profile = db.get(Setting, "memory:context:profile")
    if profile and profile.value.strip():
        sections.append(f"## About the User\n{profile.value}")
        context_files_used.append("profile")

    # 4. Style context file
    style = db.get(Setting, "memory:context:style")
    if style and style.value.strip():
        sections.append(f"## Communication Style\n{style.value}")
        context_files_used.append("style")

    # 5. Expert context file (when expert-scoped)
    if scope == "expert" and scope_id:
        expert_ctx = db.get(Setting, f"memory:context:expert:{scope_id}")
        if expert_ctx and expert_ctx.value.strip():
            sections.append(f"## Expert Context\n{expert_ctx.value}")
            context_files_used.append(f"expert:{scope_id}")

    # 6. Learned facts — top-K by semantic relevance
    recall_items: list[MemoryItem] = []
    if recent_messages:
        query = " ".join(m.get("content", "") for m in recent_messages[-3:])
        recall_items = await recall_relevant(query, scope, scope_id, db, top_k=10)

    if recall_items:
        lines = [f"- {item.content}" for item in recall_items]
        sections.append("## What You Know About the User\n" + "\n".join(lines))

    # 7. Knowledge entries — recent + relevant
    knowledge_summary, knowledge_count = await recall_knowledge(
        recent_messages, scope, scope_id, db,
        recent_count=15,
        relevant_count=5,
    )
    if knowledge_summary:
        sections.append(f"## Recent Activity & Records\n{knowledge_summary}")

    return MemoryContextResponse(
        system_prompt="\n\n".join(sections),
        context_files_used=context_files_used,
        recall_item_count=len(recall_items),
        knowledge_entry_count=knowledge_count,
    )
