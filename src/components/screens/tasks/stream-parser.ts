/**
 * TaskStreamParser — stateful parser that scans the raw text_delta stream
 * from a Claude Code task subprocess and emits structured TaskStreamEvents.
 *
 * Recognizes:
 *   Clarify mode:  <ready/>, <clarification>{JSON}</clarification>
 *   Execute mode:  <plan kind="...">{JSON}</plan>, <phase id=... name=...>,
 *                  <phase_summary>...</phase_summary>, </phase>,
 *                  <deliverable kind=... title=...>...</deliverable>,
 *                  <run_info>{JSON}</run_info>
 *
 * The parser buffers text across chunks so partial tags don't break.
 */

import type { ClarificationQuestion, DeliverableKind, RunInfo, TaskPlan } from './types';

// ── Event types ─────────────────────────────────────────────────

export type TaskStreamEvent =
  | { type: 'ready' }
  | { type: 'clarification'; questions: ClarificationQuestion[] }
  | { type: 'plan'; plan: TaskPlan; kind: DeliverableKind }
  | { type: 'phase_start'; phaseId: string; name: string }
  | { type: 'phase_summary'; phaseId: string; summary: string }
  | { type: 'phase_end'; phaseId: string }
  | { type: 'deliverable'; title: string | null; kind: DeliverableKind; markdown: string }
  | { type: 'run_info'; info: RunInfo };

// ── Regex patterns ──────────────────────────────────────────────

const RE_READY = /<ready\s*\/>/;
const RE_CLARIFICATION = /<clarification>([\s\S]*?)<\/clarification>/;
const RE_PLAN = /<plan\s+kind="([^"]*)">([\s\S]*?)<\/plan>/;
const RE_PHASE_START = /<phase\s+id="([^"]*)"\s+name="([^"]*)">/;
const RE_PHASE_SUMMARY = /<phase_summary>([\s\S]*?)<\/phase_summary>/;
const RE_PHASE_END = /<\/phase>/;
const RE_DELIVERABLE = /<deliverable\s+kind="([^"]*)"(?:\s+title="([^"]*)")?\s*>([\s\S]*?)<\/deliverable>/;
const RE_RUN_INFO = /<run_info>([\s\S]*?)<\/run_info>/;

// ── Parser ──────────────────────────────────────────────────────

export class TaskStreamParser {
  private buffer = '';
  private currentPhaseId: string | null = null;
  private mode: 'clarify' | 'execute';

  /** Track what we've already emitted so we don't double-fire. */
  private emittedReady = false;
  private emittedClarification = false;
  private emittedPlan = false;
  private emittedDeliverable = false;
  private emittedRunInfo = false;

  constructor(mode: 'clarify' | 'execute') {
    this.mode = mode;
  }

  /** Feed a chunk of streamed text. Returns any events that can now be emitted. */
  feed(chunk: string): TaskStreamEvent[] {
    this.buffer += chunk;
    const events: TaskStreamEvent[] = [];

    if (this.mode === 'clarify') {
      this.parseClarifyMode(events);
    } else {
      this.parseExecuteMode(events);
    }

    return events;
  }

  /** Flush remaining buffer on stream end. */
  flush(): TaskStreamEvent[] {
    const events: TaskStreamEvent[] = [];

    if (this.mode === 'clarify') {
      // If we never got <ready/> or <clarification>, treat as ready
      if (!this.emittedReady && !this.emittedClarification) {
        events.push({ type: 'ready' });
        this.emittedReady = true;
      }
    } else {
      // Try final parse of any remaining tags
      this.parseExecuteMode(events);

      // If no deliverable was emitted, treat the entire buffer as markdown
      if (!this.emittedDeliverable && this.buffer.trim()) {
        events.push({
          type: 'deliverable',
          title: null,
          kind: 'markdown',
          markdown: this.buffer.trim(),
        });
        this.emittedDeliverable = true;
      }
    }

    return events;
  }

  getCurrentPhaseId(): string | null {
    return this.currentPhaseId;
  }

  // ── Private ───────────────────────────────────────────────────

  private parseClarifyMode(events: TaskStreamEvent[]): void {
    if (!this.emittedReady && RE_READY.test(this.buffer)) {
      events.push({ type: 'ready' });
      this.emittedReady = true;
      this.consumeMatch(RE_READY);
    }

    if (!this.emittedClarification) {
      const m = RE_CLARIFICATION.exec(this.buffer);
      if (m) {
        try {
          const parsed = JSON.parse(m[1]);
          const questions = Array.isArray(parsed.questions) ? parsed.questions : [];
          events.push({ type: 'clarification', questions });
          this.emittedClarification = true;
        } catch {
          // Incomplete JSON — wait for more chunks
        }
        if (this.emittedClarification) {
          this.consumeMatch(RE_CLARIFICATION);
        }
      }
    }
  }

  private parseExecuteMode(events: TaskStreamEvent[]): void {
    // Plan
    if (!this.emittedPlan) {
      const m = RE_PLAN.exec(this.buffer);
      if (m) {
        try {
          const kind = this.parseKind(m[1]);
          const parsed = JSON.parse(m[2]);
          const phases = Array.isArray(parsed.phases) ? parsed.phases : [];
          const plan: TaskPlan = {
            phases: phases.map((p: any) => ({
              id: p.id || '',
              name: p.name || '',
              description: p.description || '',
              expert_slug: p.expert_slug || null,
              needs_new_expert: Boolean(p.needs_new_expert),
              new_expert: p.new_expert || null,
              status: p.status || 'pending',
              child_run_id: p.child_run_id || null,
              summary: p.summary || null,
            })),
          };
          events.push({ type: 'plan', plan, kind });
          this.emittedPlan = true;
          this.consumeMatch(RE_PLAN);
        } catch {
          // Incomplete — wait
        }
      }
    }

    // Phase start (can fire multiple times)
    let phaseStartMatch: RegExpExecArray | null;
    while ((phaseStartMatch = RE_PHASE_START.exec(this.buffer)) !== null) {
      const phaseId = phaseStartMatch[1];
      const name = phaseStartMatch[2];
      this.currentPhaseId = phaseId;
      events.push({ type: 'phase_start', phaseId, name });
      this.buffer =
        this.buffer.slice(0, phaseStartMatch.index) +
        this.buffer.slice(phaseStartMatch.index + phaseStartMatch[0].length);
    }

    // Phase summary
    let summaryMatch: RegExpExecArray | null;
    while ((summaryMatch = RE_PHASE_SUMMARY.exec(this.buffer)) !== null) {
      const summary = summaryMatch[1].trim();
      if (this.currentPhaseId) {
        events.push({ type: 'phase_summary', phaseId: this.currentPhaseId, summary });
      }
      this.buffer =
        this.buffer.slice(0, summaryMatch.index) +
        this.buffer.slice(summaryMatch.index + summaryMatch[0].length);
    }

    // Phase end
    let endMatch: RegExpExecArray | null;
    while ((endMatch = RE_PHASE_END.exec(this.buffer)) !== null) {
      if (this.currentPhaseId) {
        events.push({ type: 'phase_end', phaseId: this.currentPhaseId });
        this.currentPhaseId = null;
      }
      this.buffer =
        this.buffer.slice(0, endMatch.index) +
        this.buffer.slice(endMatch.index + endMatch[0].length);
    }

    // Deliverable
    if (!this.emittedDeliverable) {
      const m = RE_DELIVERABLE.exec(this.buffer);
      if (m) {
        const kind = this.parseKind(m[1]);
        const title = m[2] || null;
        const markdown = m[3].trim();
        events.push({ type: 'deliverable', title, kind, markdown });
        this.emittedDeliverable = true;
        this.consumeMatch(RE_DELIVERABLE);
      }
    }

    // Run info
    if (!this.emittedRunInfo) {
      const m = RE_RUN_INFO.exec(this.buffer);
      if (m) {
        try {
          const info = JSON.parse(m[1]) as RunInfo;
          events.push({ type: 'run_info', info });
          this.emittedRunInfo = true;
          this.consumeMatch(RE_RUN_INFO);
        } catch {
          // Incomplete — wait
        }
      }
    }
  }

  private consumeMatch(re: RegExp): void {
    this.buffer = this.buffer.replace(re, '');
  }

  private parseKind(raw: string): DeliverableKind {
    if (raw === 'code_app' || raw === 'mixed') return raw;
    return 'markdown';
  }
}
