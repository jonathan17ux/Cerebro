/**
 * Routine execution tool for the agent system.
 * Lets the LLM trigger routine execution from chat.
 */

import { Type } from '@sinclair/typebox';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import type { ToolContext } from '../types';
import type { DAGDefinition } from '../../engine/dag/types';
import { backendRequest, textResult } from './tool-utils';

interface RoutineRecord {
  id: string;
  name: string;
  dag_json: string | null;
}

export function createRunRoutine(ctx: ToolContext): AgentTool {
  return {
    name: 'run_routine',
    description:
      'Run a saved routine by name or ID. Routines are automated workflows (DAGs) that the user has configured.',
    label: 'Run Routine',
    parameters: Type.Object({
      routine: Type.String({
        description: 'The routine name (case-insensitive) or ID',
      }),
    }),
    execute: async (_toolCallId, params) => {
      // 1. Fetch all routines and find match
      let routines: RoutineRecord[];
      try {
        const res = await backendRequest<{ routines: RoutineRecord[] }>(
          ctx.backendPort,
          'GET',
          '/routines?limit=200',
        );
        routines = res.routines;
      } catch (err) {
        return textResult(`Failed to fetch routines: ${err instanceof Error ? err.message : String(err)}`);
      }

      const query = params.routine.toLowerCase();
      const match = routines.find(
        (r) => r.id === params.routine || r.name.toLowerCase() === query,
      );

      if (!match) {
        const names = routines.map((r) => r.name).join(', ');
        return textResult(
          `Routine "${params.routine}" not found. Available routines: ${names || '(none)'}`,
        );
      }

      if (!match.dag_json) {
        return textResult(
          `Routine "${match.name}" has no DAG configured. Open it in the canvas editor to add steps.`,
        );
      }

      // 2. Bump backend metadata
      try {
        await backendRequest(ctx.backendPort, 'POST', `/routines/${match.id}/run`);
      } catch {
        // Non-critical — continue with execution
      }

      // 3. Execute the DAG
      if (!ctx.executionEngine || !ctx.webContents) {
        return textResult('Execution engine is not available. Try again in a moment.');
      }

      let dag: DAGDefinition;
      try {
        dag = JSON.parse(match.dag_json);
      } catch {
        return textResult(`Routine "${match.name}" has invalid DAG configuration.`);
      }

      try {
        const runId = await ctx.executionEngine.startRun(ctx.webContents, {
          dag,
          routineId: match.id,
          triggerSource: 'chat',
        });
        return textResult(`Started routine "${match.name}".\n[ENGINE_RUN_ID:${runId}]`);
      } catch (err) {
        return textResult(
          `Failed to start routine "${match.name}": ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },
  };
}
