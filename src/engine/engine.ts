/**
 * ExecutionEngine — top-level orchestrator for DAG-based routine execution.
 *
 * Manages concurrent runs, creates registries populated with all built-in
 * actions, validates DAGs, and coordinates executors with event streaming.
 */

import crypto from 'node:crypto';
import type { WebContents } from 'electron';
import type { AgentRuntime } from '../agents/runtime';
import type { EngineRunRequest } from './dag/types';
import type { EngineActiveRunInfo } from '../types/ipc';
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

    // Emit run_started
    emitter.emit({
      type: 'run_started',
      runId,
      totalSteps: request.dag.steps.length,
      timestamp: new Date().toISOString(),
    });

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
      },
    );

    // Execute asynchronously (non-blocking)
    const startTime = Date.now();
    executor
      .execute()
      .then(() => {
        emitter.emit({
          type: 'run_completed',
          runId,
          durationMs: Date.now() - startTime,
          timestamp: new Date().toISOString(),
        });
      })
      .catch((err: Error) => {
        const failedStepId = err instanceof StepFailedError ? err.stepId : 'unknown';
        emitter.emit({
          type: 'run_failed',
          runId,
          error: err.message,
          failedStepId,
          timestamp: new Date().toISOString(),
        });
      })
      .finally(() => {
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
}
