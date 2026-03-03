/**
 * ExecutionEngine — top-level orchestrator for DAG-based routine execution.
 *
 * Manages concurrent runs, creates registries populated with all built-in
 * actions, validates DAGs, and coordinates executors with event streaming.
 */

import crypto from 'node:crypto';
import http from 'node:http';
import type { WebContents } from 'electron';
import type { AgentRuntime } from '../agents/runtime';
import type { EngineRunRequest } from './dag/types';
import type { EngineActiveRunInfo } from '../types/ipc';
import type { StepPersistenceUpdate } from './dag/executor';
import { ActionRegistry } from './actions/registry';
import { modelCallAction } from './actions/model-call';
import { transformerAction } from './actions/transformer';
import { createExpertStepAction } from './actions/expert-step';
import { connectorAction } from './actions/connector';
import { channelAction } from './actions/channel';
import { RunScratchpad } from './scratchpad';
import { RunEventEmitter } from './events/emitter';
import { validateDAG } from './dag/validator';
import { DAGExecutor, StepFailedError } from './dag/executor';
import { resolveModel } from '../agents/model-resolver';

interface ActiveEngineRun {
  runId: string;
  abortController: AbortController;
  startedAt: number;
  routineId?: string;
}

export class ExecutionEngine {
  private backendPort: number;
  private agentRuntime: AgentRuntime;
  private activeRuns = new Map<string, ActiveEngineRun>();

  constructor(backendPort: number, agentRuntime: AgentRuntime) {
    this.backendPort = backendPort;
    this.agentRuntime = agentRuntime;
  }

  /**
   * Start a new DAG execution run.
   * Returns the runId immediately; execution proceeds asynchronously.
   */
  async startRun(webContents: WebContents, request: EngineRunRequest): Promise<string> {
    const runId = crypto.randomUUID().replace(/-/g, '').slice(0, 32);
    const abortController = new AbortController();

    // Build registry with all built-in actions
    const registry = this.createRegistry(webContents);

    // Validate DAG before execution
    validateDAG(request.dag, registry);

    // Create per-run resources
    const scratchpad = new RunScratchpad();
    const emitter = new RunEventEmitter(webContents, runId);

    // Track this run
    const activeRun: ActiveEngineRun = {
      runId,
      abortController,
      startedAt: Date.now(),
      routineId: request.routineId,
    };
    this.activeRuns.set(runId, activeRun);

    // Persist run record (fire-and-forget)
    this.backendRequest('POST', '/engine/runs', {
      id: runId,
      routine_id: request.routineId ?? null,
      run_type: 'routine',
      trigger: request.triggerSource ?? 'manual',
      dag_json: JSON.stringify(request.dag),
      total_steps: request.dag.steps.length,
    }).catch(console.error);

    // Batch-create step records and build stepId→stepRecordId map
    const stepRecordIdMap = new Map<string, string>();
    const stepBodies = request.dag.steps.map((step, index) => {
      const stepRecordId = crypto.randomUUID().replace(/-/g, '').slice(0, 32);
      stepRecordIdMap.set(step.id, stepRecordId);
      return {
        id: stepRecordId,
        step_id: step.id,
        step_name: step.name,
        action_type: step.actionType,
        status: 'pending',
        order_index: index,
      };
    });
    this.backendRequest('POST', `/engine/runs/${runId}/steps`, stepBodies).catch(console.error);

    // Emit run_started
    emitter.emit({
      type: 'run_started',
      runId,
      totalSteps: request.dag.steps.length,
      timestamp: new Date().toISOString(),
    });

    // Step persistence callback (tracks actual completions for the run record)
    let completedStepCount = 0;
    const onStepUpdate = (stepId: string, update: StepPersistenceUpdate) => {
      const stepRecordId = stepRecordIdMap.get(stepId);
      if (!stepRecordId) return;
      if (update.status === 'completed') completedStepCount++;
      this.backendRequest('PATCH', `/engine/runs/${runId}/steps/${stepRecordId}`, update)
        .catch(console.error);
    };

    // Create executor
    const executor = new DAGExecutor(
      request.dag,
      registry,
      scratchpad,
      emitter,
      {
        runId,
        backendPort: this.backendPort,
        signal: abortController.signal,
        resolveModel: () => resolveModel(null, this.backendPort),
        onStepUpdate,
      },
    );

    // Execute asynchronously (non-blocking)
    const startTime = Date.now();
    executor
      .execute()
      .then(() => {
        const durationMs = Date.now() - startTime;
        emitter.emit({
          type: 'run_completed',
          runId,
          durationMs,
          timestamp: new Date().toISOString(),
        });

        // Persist run completion
        this.backendRequest('PATCH', `/engine/runs/${runId}`, {
          status: 'completed',
          completed_steps: completedStepCount,
          completed_at: new Date().toISOString(),
          duration_ms: durationMs,
        }).catch(console.error);
      })
      .catch((err: Error) => {
        const isCancelled = abortController.signal.aborted;

        if (isCancelled) {
          emitter.emit({
            type: 'run_cancelled',
            runId,
            reason: 'Run was cancelled',
            timestamp: new Date().toISOString(),
          });
          this.backendRequest('PATCH', `/engine/runs/${runId}`, {
            status: 'cancelled',
            completed_at: new Date().toISOString(),
            duration_ms: Date.now() - startTime,
          }).catch(console.error);
        } else {
          const failedStepId = err instanceof StepFailedError ? err.stepId : 'unknown';
          emitter.emit({
            type: 'run_failed',
            runId,
            error: err.message,
            failedStepId,
            timestamp: new Date().toISOString(),
          });
          this.backendRequest('PATCH', `/engine/runs/${runId}`, {
            status: 'failed',
            error: err.message,
            failed_step_id: failedStepId,
            completed_at: new Date().toISOString(),
            duration_ms: Date.now() - startTime,
          }).catch(console.error);
        }
      })
      .finally(() => {
        // Batch-persist event buffer
        const buffer = emitter.getBuffer();
        if (buffer.length > 0) {
          const events = buffer.map((event, i) => ({
            seq: i,
            event_type: event.type,
            step_id: 'stepId' in event ? (event as Record<string, unknown>).stepId as string : null,
            payload_json: JSON.stringify(event),
            timestamp: 'timestamp' in event ? (event as Record<string, unknown>).timestamp as string : new Date().toISOString(),
          }));
          this.backendRequest('POST', `/engine/runs/${runId}/events`, { events })
            .catch(console.error);
        }

        scratchpad.clear();
        this.activeRuns.delete(runId);
      });

    return runId;
  }

  /** Cancel a running DAG execution. */
  cancelRun(runId: string): boolean {
    const run = this.activeRuns.get(runId);
    if (!run) return false;
    run.abortController.abort();
    this.activeRuns.delete(runId);
    return true;
  }

  /** Get info about all active runs. */
  getActiveRuns(): EngineActiveRunInfo[] {
    return Array.from(this.activeRuns.values()).map((run) => ({
      runId: run.runId,
      routineId: run.routineId,
      startedAt: run.startedAt,
    }));
  }

  /** Create an ActionRegistry populated with all built-in actions. */
  private createRegistry(webContents: WebContents): ActionRegistry {
    const registry = new ActionRegistry();

    registry.register(modelCallAction);
    registry.register(transformerAction);
    registry.register(createExpertStepAction({
      agentRuntime: this.agentRuntime,
      webContents,
    }));
    registry.register(connectorAction);
    registry.register(channelAction);

    return registry;
  }

  /** Fire-and-forget HTTP request to the backend. */
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
