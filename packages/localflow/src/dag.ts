/**
 * LocalFlow DAG event emitter.
 *
 * Writes signed DAG vertices for every lifecycle event in a LocalFlow task.
 * In production this publishes to the dag-substrate service (port 4008) via Redis pubsub.
 * In prototype mode it logs to stdout and optionally to an in-memory store.
 *
 * Users never see this. It runs silently in the background.
 */

import { randomUUID } from 'crypto';
import type { DagVertex, LocalflowVertexType, Task, UserId, VertexId } from './types.js';
import { computeLocalflowLoop } from './xp.js';

/** Lightweight in-memory vertex store for prototype mode */
const vertexStore: Map<VertexId, DagVertex> = new Map();
let lamportClock = 0;

function nextLamport(): number {
  return ++lamportClock;
}

/**
 * Write a DAG vertex for a task lifecycle event.
 * Returns the written vertex.
 */
export function writeVertex(
  type: LocalflowVertexType,
  task: Task,
  actorIds: UserId[],
  payload: Record<string, unknown> = {},
  parentVertexIds: VertexId[] = [],
): DagVertex {
  const vertex: DagVertex = {
    id: randomUUID(),
    type,
    taskId: task.id,
    actorIds,
    payload,
    lamportTimestamp: nextLamport(),
    wallTimestamp: new Date().toISOString(),
    parentVertexIds,
  };

  vertexStore.set(vertex.id, vertex);

  // In production: publish to Redis channel `dag:vertex:localflow`
  // so dag-substrate (port 4008) picks it up via its event bus integration.
  console.log(`[dag] ${type} | task=${task.id} | vertex=${vertex.id}`);

  return vertex;
}

/**
 * Emit LOOPOPEN when a task is created.
 */
export function emitLoopOpen(task: Task): DagVertex {
  return writeVertex('LOOPOPEN', task, [task.clientId], {
    type: task.type,
    description: task.description,
    zone: task.zone,
    requestedBy: task.requestedBy,
  });
}

/**
 * Emit LOOPCLOSE + XPMINT_PROVISIONAL when client confirms task completion.
 * Convergence requires both clientId and driverId — solo tasks cannot mint.
 */
export function emitLoopClose(task: Task): { closeVertex: DagVertex; mintVertex: DagVertex } | null {
  if (!task.driverId || !task.confirmedAt || !task.completedAt) {
    console.warn('[dag] emitLoopClose called on incomplete task — skipping');
    return null;
  }

  // Compute settlement time factor Ts:
  // Ts = elapsed_ms / target_ms, clamped to [0.01, 1.0]
  const openMs = new Date(task.requestedBy).getTime();
  const closeMs = new Date(task.confirmedAt).getTime();
  const elapsedMs = closeMs - openMs;
  // Default target: 4 hours for a local errand
  const targetMs = 4 * 60 * 60 * 1000;
  const Ts = Math.min(1.0, Math.max(0.01, elapsedMs / targetMs));

  // deltaS: time saved proxy — inverse of normalized elapsed time
  // Real instrument would use structured before/after measurement.
  // Prototype uses a simple proxy: tasks completed faster than target get higher deltaS.
  const deltaS = Math.max(0.01, 1.0 - Ts + 0.1);

  const xpResult = computeLocalflowLoop({ deltaS, Ts });

  const priorVertices = task.dagVertices;

  const closeVertex = writeVertex(
    'LOOPCLOSE',
    task,
    [task.clientId, task.driverId],
    {
      convergence: true,
      confirmedAt: task.confirmedAt,
      completedAt: task.completedAt,
      elapsedMs,
      Ts,
      deltaS,
    },
    priorVertices,
  );

  const mintVertex = writeVertex(
    'XPMINT_PROVISIONAL',
    task,
    [task.driverId],
    {
      xpProvisional: xpResult.xp,
      ep: xpResult.ep,
      L: xpResult.L,
      formulaInputs: xpResult.inputs,
      settleAfter: new Date(closeMs + 30 * 24 * 60 * 60 * 1000).toISOString(),
    },
    [closeVertex.id],
  );

  mintVertex.xpProvisional = xpResult.xp;

  return { closeVertex, mintVertex };
}

/**
 * Retrieve all vertices for a given task (audit trail).
 */
export function getVerticesByTask(taskId: string): DagVertex[] {
  return Array.from(vertexStore.values()).filter(v => v.taskId === taskId);
}

/**
 * Get full in-memory vertex store (for observability endpoint).
 */
export function getAllVertices(): DagVertex[] {
  return Array.from(vertexStore.values());
}
