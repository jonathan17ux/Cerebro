/**
 * OrchestrationTracker — lazily creates RunRecords when agent orchestration occurs.
 *
 * For simple Q&A (no delegation/team/routine), the tracker stays dormant and
 * no RunRecord is ever created. On the first orchestration action, it lazily
 * creates a RunRecord of type 'orchestration' and tracks steps + events.
 */

import http from 'node:http';
import crypto from 'node:crypto';

interface TrackerOpts {
  runId: string;
  conversationId: string;
  expertId: string | null;
  parentRunId: string | null;
  backendPort: number;
}

export class OrchestrationTracker {
  private readonly runId: string;
  private readonly conversationId: string;
  private readonly expertId: string | null;
  private readonly parentRunId: string | null;
  private readonly backendPort: number;

  private runRecordCreated = false;
  private createdAt = 0;
  private stepSeq = 0;
  private completedSteps = 0;
  private eventSeq = 0;
  private eventBuffer: Array<{ seq: number; event_type: string; step_id: string | null; payload_json: string; timestamp: string }> = [];

  /** Maps childRunId/teamId → stepId for step finalization. */
  private stepMap = new Map<string, string>();

  constructor(opts: TrackerOpts) {
    this.runId = opts.runId;
    this.conversationId = opts.conversationId;
    this.expertId = opts.expertId;
    this.parentRunId = opts.parentRunId;
    this.backendPort = opts.backendPort;
  }

  // ── Public API ──────────────────────────────────────────────────

  get isActive(): boolean {
    return this.runRecordCreated;
  }

  get id(): string {
    return this.runId;
  }

  async recordDelegationStart(expertId: string, expertName: string, childRunId: string): Promise<void> {
    try {
      await this.ensureRunRecord();
    } catch {
      return; // Tracking is non-critical — don't break delegation
    }
    const stepId = this.nextStepId();
    this.stepMap.set(childRunId, stepId);
    this.addStep(stepId, `Delegate to ${expertName}`, 'delegation', {
      expert_id: expertId,
      child_run_id: childRunId,
    });
    this.bufferEvent('delegation_start', stepId, { expert_id: expertId, expert_name: expertName, child_run_id: childRunId });
  }

  recordDelegationEnd(childRunId: string, status: string, durationMs: number): void {
    const stepId = this.stepMap.get(childRunId);
    this.bufferEvent('delegation_end', stepId ?? null, { child_run_id: childRunId, status, duration_ms: durationMs });
    if (stepId) {
      this.patchStep(stepId, status === 'completed' ? 'completed' : 'failed', durationMs);
      this.stepMap.delete(childRunId);
    }
  }

  async recordTeamStart(teamId: string, teamName: string, strategy: string, memberCount: number): Promise<void> {
    try {
      await this.ensureRunRecord();
    } catch {
      return;
    }
    const stepId = this.nextStepId();
    this.stepMap.set(teamId, stepId);
    this.addStep(stepId, `Team: ${teamName}`, 'team_run', {
      team_id: teamId,
      strategy,
      member_count: memberCount,
    });
    this.bufferEvent('team_start', stepId, { team_id: teamId, team_name: teamName, strategy, member_count: memberCount });
  }

  recordTeamEnd(teamId: string, status: string, successCount: number, totalCount: number, durationMs?: number): void {
    const stepId = this.stepMap.get(teamId);
    this.bufferEvent('team_end', stepId ?? null, { team_id: teamId, status, success_count: successCount, total_count: totalCount });
    if (stepId) {
      this.patchStep(stepId, status === 'completed' ? 'completed' : 'failed', durationMs);
      this.stepMap.delete(teamId);
    }
  }

  async recordRoutineTriggered(routineId: string, engineRunId: string): Promise<void> {
    try {
      await this.ensureRunRecord();
    } catch {
      return;
    }
    const stepId = this.nextStepId();
    this.addStep(stepId, `Run routine`, 'routine', {
      routine_id: routineId,
      engine_run_id: engineRunId,
    });
    this.bufferEvent('routine_triggered', stepId, { routine_id: routineId, engine_run_id: engineRunId });
    // Link the engine run as child by patching its parent_run_id
    this.backendRequest('PATCH', `/engine/runs/${engineRunId}`, { parent_run_id: this.runId }).catch(() => {});
    // Mark step as completed — the routine's own RunRecord tracks its execution
    this.patchStep(stepId, 'completed');
  }

  async finalize(status: 'completed' | 'error' | 'cancelled'): Promise<void> {
    if (!this.runRecordCreated) return;

    // Batch-persist buffered events
    if (this.eventBuffer.length > 0) {
      try {
        await this.backendRequest('POST', `/engine/runs/${this.runId}/events`, {
          events: this.eventBuffer,
        });
        this.eventBuffer = [];
      } catch (err) {
        console.error(`[OrchestrationTracker] Failed to flush ${this.eventBuffer.length} events for run ${this.runId}:`, err);
      }
    }

    // Update run record to final status (include step counters as authoritative snapshot)
    const now = new Date().toISOString();
    const durationMs = this.createdAt > 0 ? Date.now() - this.createdAt : undefined;
    try {
      await this.backendRequest('PATCH', `/engine/runs/${this.runId}`, {
        status: status === 'error' ? 'failed' : status,
        completed_at: now,
        total_steps: this.stepSeq,
        completed_steps: this.completedSteps,
        ...(durationMs !== undefined && { duration_ms: durationMs }),
      });
    } catch (err) {
      console.error(`[OrchestrationTracker] Failed to finalize run ${this.runId}:`, err);
    }
  }

  // ── Internal ────────────────────────────────────────────────────

  private createPromise: Promise<void> | null = null;

  private async ensureRunRecord(): Promise<void> {
    if (this.runRecordCreated) return;

    // Guard against concurrent callers: first caller creates the promise,
    // subsequent callers await the same one.
    if (this.createPromise) return this.createPromise;

    this.createPromise = this.backendRequest('POST', '/engine/runs', {
      id: this.runId,
      expert_id: this.expertId,
      conversation_id: this.conversationId,
      parent_run_id: this.parentRunId,
      run_type: 'orchestration',
      trigger: 'chat',
      total_steps: 0,
    }).then(() => {
      this.runRecordCreated = true;
      this.createdAt = Date.now();
    }).catch((err) => {
      // Reset so a future call can retry
      this.createPromise = null;
      throw err;
    });

    return this.createPromise;
  }

  private nextStepId(): string {
    return crypto.randomUUID().replace(/-/g, '').slice(0, 32);
  }

  private addStep(stepId: string, name: string, actionType: string, input?: Record<string, unknown>): void {
    const order = this.stepSeq++;
    this.backendRequest('POST', `/engine/runs/${this.runId}/steps`, [
      {
        id: stepId,
        step_id: stepId,
        step_name: name,
        action_type: actionType,
        status: 'running',
        order_index: order,
        input_json: input ? JSON.stringify(input) : null,
      },
    ]).then(() => {
      // Update total_steps on run record after step creation
      this.backendRequest('PATCH', `/engine/runs/${this.runId}`, {
        total_steps: this.stepSeq,
      }).catch(() => {});
    }).catch(() => {});
  }

  private patchStep(stepId: string, status: string, durationMs?: number): void {
    this.backendRequest('PATCH', `/engine/runs/${this.runId}/steps/${stepId}`, {
      status,
      completed_at: new Date().toISOString(),
      ...(durationMs !== undefined && { duration_ms: durationMs }),
    }).then(() => {
      // Update completed_steps on terminal status
      if (status === 'completed' || status === 'failed') {
        this.completedSteps++;
        this.backendRequest('PATCH', `/engine/runs/${this.runId}`, {
          completed_steps: this.completedSteps,
        }).catch(() => {});
      }
    }).catch(() => {});
  }

  private bufferEvent(type: string, stepId: string | null, payload: Record<string, unknown>): void {
    this.eventBuffer.push({
      seq: this.eventSeq++,
      event_type: type,
      step_id: stepId,
      payload_json: JSON.stringify(payload),
      timestamp: new Date().toISOString(),
    });
  }

  private backendRequest(method: string, path: string, body: unknown): Promise<void> {
    return new Promise((resolve, reject) => {
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
          res.resume(); // drain
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`${method} ${path} returned ${res.statusCode}`));
          } else {
            resolve();
          }
        },
      );
      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error(`${method} ${path} timed out`));
      });
      req.write(bodyStr);
      req.end();
    });
  }
}
