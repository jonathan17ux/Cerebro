/**
 * DAG ↔ ReactFlow conversion utilities.
 *
 * dagToFlow: Parses a DAGDefinition into ReactFlow nodes/edges with dagre auto-layout.
 * flowToDag: Reconstructs a DAGDefinition from ReactFlow nodes/edges.
 */

import dagre from '@dagrejs/dagre';
import { MarkerType, type Node, type Edge } from '@xyflow/react';
import type { DAGDefinition, StepDefinition } from '../engine/dag/types';

// ── Types ─────────────────────────────────────────────────────

export interface RoutineStepData extends Record<string, unknown> {
  stepId: string;
  name: string;
  actionType: string;
  params: Record<string, unknown>;
  dependsOn: string[];
  inputMappings: StepDefinition['inputMappings'];
  requiresApproval: boolean;
  onError: 'fail' | 'skip' | 'retry';
  maxRetries?: number;
  timeoutMs?: number;
}

// ── Constants ─────────────────────────────────────────────────

const NODE_WIDTH = 200;
const NODE_HEIGHT = 80;
const NODESEP = 60;
const RANKSEP = 80;

// ── Auto-layout ───────────────────────────────────────────────

export function autoLayoutNodes(nodes: Node[], edges: Edge[]): Node[] {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: 'TB', nodesep: NODESEP, ranksep: RANKSEP });

  for (const node of nodes) {
    g.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  }
  for (const edge of edges) {
    g.setEdge(edge.source, edge.target);
  }

  dagre.layout(g);

  return nodes.map((node) => {
    const pos = g.node(node.id);
    return {
      ...node,
      position: {
        x: pos.x - NODE_WIDTH / 2,
        y: pos.y - NODE_HEIGHT / 2,
      },
    };
  });
}

// ── DAG → ReactFlow ───────────────────────────────────────────

export function dagToFlow(dag: DAGDefinition): { nodes: Node[]; edges: Edge[] } {
  if (!dag.steps || dag.steps.length === 0) {
    return { nodes: [], edges: [] };
  }

  const nodes: Node[] = dag.steps.map((step) => ({
    id: step.id,
    type: 'routineStep',
    position: { x: 0, y: 0 }, // will be set by dagre
    data: {
      stepId: step.id,
      name: step.name,
      actionType: step.actionType,
      params: step.params,
      dependsOn: step.dependsOn,
      inputMappings: step.inputMappings,
      requiresApproval: step.requiresApproval,
      onError: step.onError,
      maxRetries: step.maxRetries,
      timeoutMs: step.timeoutMs,
    } as RoutineStepData,
  }));

  const edges: Edge[] = [];
  for (const step of dag.steps) {
    for (const depId of step.dependsOn) {
      edges.push({
        id: `e-${depId}-${step.id}`,
        source: depId,
        target: step.id,
        type: 'smoothstep',
        markerEnd: { type: MarkerType.ArrowClosed, color: '#06b6d4' },
        style: { stroke: '#06b6d4', strokeWidth: 1.5 },
      });
    }
  }

  const layoutNodes = autoLayoutNodes(nodes, edges);
  return { nodes: layoutNodes, edges };
}

// ── ReactFlow → DAG ───────────────────────────────────────────

export function flowToDag(nodes: Node[], edges: Edge[]): DAGDefinition {
  // Build a map of target node → list of source node ids
  const incomingMap = new Map<string, string[]>();
  for (const edge of edges) {
    const deps = incomingMap.get(edge.target) ?? [];
    deps.push(edge.source);
    incomingMap.set(edge.target, deps);
  }

  const steps: StepDefinition[] = nodes.map((node) => {
    const d = node.data as RoutineStepData;
    return {
      id: d.stepId,
      name: d.name,
      actionType: d.actionType,
      params: d.params,
      dependsOn: incomingMap.get(node.id) ?? [],
      inputMappings: d.inputMappings ?? [],
      requiresApproval: d.requiresApproval ?? false,
      onError: d.onError ?? 'fail',
      maxRetries: d.maxRetries,
      timeoutMs: d.timeoutMs,
    };
  });

  return { steps };
}
