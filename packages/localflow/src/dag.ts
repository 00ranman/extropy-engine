/**
 * LocalFlow DAG event emitter.
 *
 * Writes DAG vertices for every lifecycle event in a LocalFlow task.
 * In production this publishes to the dag-substrate service (port 4008) via
 * Redis pubsub. In prototype mode it logs to stdout and keeps an in-memory
 * store.
 *
 * Measurement integrity: closing a loop always emits a canonical MEASUREMENT
 * vertex carrying raw baseline and outcome evidence. XP minting is gated on an
 * explicitly supplied, validated normalized measurement. Elapsed time is never
 * treated as a normalized entropy delta.
 */

import { randomUUID } from 'crypto';
import {
  CANONICAL_VERTEX_TYPE,
  type DagVertex,
  type LocalflowVertexType,
  type NormalizedMeasurement,
  type Task,
  type UserId,
  type VertexId,
} from './types.js';
import { assembleMeasurementRecord } from './measurement.js';
import { settleFromNormalized } from './xp.js';

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
    canonicalType: CANONICAL_VERTEX_TYPE[type],
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
  console.log(`[dag] ${type} (${vertex.canonicalType}) | task=${task.id} | vertex=${vertex.id}`);

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
    expectedDurationSeconds: task.expectedDurationSeconds,
    domain: task.domain,
  });
}

export interface LoopCloseResult {
  closeVertex: DagVertex;
  /** Canonical MEASUREMENT vertex carrying raw baseline + outcome evidence. */
  measurementVertex: DagVertex;
  /** Present only when a validated normalized measurement allowed minting. */
  mintVertex: DagVertex | null;
  /** Explicit status: whether XP settlement proceeded or remained pending. */
  settlement: 'minted' | 'pending';
}

/**
 * Emit LOOPCLOSE + MEASUREMENT when the client confirms task completion, and
 * gate XPMINT_PROVISIONAL on a validated normalized measurement.
 *
 * Convergence requires both clientId and driverId - solo tasks cannot close.
 *
 * If `normalized` is omitted, the loop closes and a MEASUREMENT vertex is
 * written with normalizationStatus 'unavailable', but no XP is minted: the
 * settlement stays 'pending'. This is the honest path when no validated
 * normalization exists.
 */
export function emitLoopClose(
  task: Task,
  normalized?: NormalizedMeasurement,
): LoopCloseResult | null {
  if (!task.driverId || !task.confirmedAt || !task.completedAt) {
    console.warn('[dag] emitLoopClose called on incomplete task - skipping');
    return null;
  }

  const record = assembleMeasurementRecord(task, normalized);
  const priorVertices = task.dagVertices;

  // Raw-only close vertex. No synthesized deltaS, no synthesized Ts.
  const closeVertex = writeVertex(
    'LOOPCLOSE',
    task,
    [task.clientId, task.driverId],
    {
      convergence: true,
      confirmedAt: task.confirmedAt,
      completedAt: task.completedAt,
      actualDurationSeconds: record.outcome.actualDurationSeconds,
      completionStatus: record.outcome.completionStatus,
      independentConfirmation: record.outcome.independentConfirmation,
    },
    priorVertices,
  );

  const measurementVertex = writeVertex(
    'MEASUREMENT',
    task,
    [task.clientId, task.driverId],
    { record: record as unknown as Record<string, unknown> },
    [closeVertex.id],
  );

  // Gate: only mint when a validated normalized measurement is present and the
  // canonical formula accepts it. Otherwise remain pending.
  if (record.normalizationStatus !== 'normalized' || !record.normalized) {
    return { closeVertex, measurementVertex, mintVertex: null, settlement: 'pending' };
  }

  const xpResult = settleFromNormalized(record.normalized);
  if (!xpResult) {
    return { closeVertex, measurementVertex, mintVertex: null, settlement: 'pending' };
  }

  const closeMs = new Date(task.confirmedAt).getTime();
  const mintVertex = writeVertex(
    'XPMINT_PROVISIONAL',
    task,
    [task.driverId],
    {
      xpProvisional: xpResult.xp,
      ep: xpResult.ep,
      L: xpResult.L,
      formulaVersion: xpResult.formulaVersion,
      formulaInputs: xpResult.inputs,
      normalizedBy: record.normalized.normalizedBy,
      simulated: record.normalized.simulated,
      settleAfter: new Date(closeMs + 30 * 24 * 60 * 60 * 1000).toISOString(),
    },
    [measurementVertex.id],
  );

  mintVertex.xpProvisional = xpResult.xp;

  return { closeVertex, measurementVertex, mintVertex, settlement: 'minted' };
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

/**
 * Reset the in-memory vertex store. Test-only helper.
 */
export function _resetVertexStore(): void {
  vertexStore.clear();
  lamportClock = 0;
}
