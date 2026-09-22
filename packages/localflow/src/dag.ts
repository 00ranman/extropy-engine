import { randomUUID } from 'crypto';
import { closeLoop, packageClaim } from '@extropy/signalflow';
import type { DagVertex, LocalflowVertexType, Task, UserId, VertexId } from './types.js';

const vertexStore: Map<VertexId, DagVertex> = new Map();
let lamportClock = 0;

function nextLamport(): number {
  return ++lamportClock;
}

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
  console.log(`[dag] ${type} | task=${task.id} | vertex=${vertex.id}`);
  return vertex;
}

export function emitLoopOpen(task: Task): DagVertex {
  const packed = packageClaim({
    face: 'localflow',
    class: `errand.${task.type}`,
  });
  return writeVertex('LOOPOPEN', task, [task.clientId], {
    type: task.type,
    description: task.description,
    zone: task.zone,
    requestedBy: task.requestedBy,
    strip: packed.strip,
  });
}

export function emitLoopClose(task: Task): { closeVertex: DagVertex; mintVertex: DagVertex } | null {
  if (!task.driverId || !task.confirmedAt || !task.completedAt) {
    console.warn('[dag] emitLoopClose called on incomplete task — skipping');
    return null;
  }

  const openMs = new Date(task.requestedBy).getTime();
  const closeMs = new Date(task.confirmedAt).getTime();
  const elapsedMs = Math.max(0, closeMs - openMs);
  const packed = packageClaim({
    face: 'localflow',
    class: `errand.${task.type}`,
  });
  const closed = closeLoop(packed, {
    bothSigned: true,
    deltaTSeconds: elapsedMs / 1000,
  });

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
      minted: closed.minted,
      reason: closed.minted ? undefined : closed.reason,
    },
    priorVertices,
  );

  const mintVertex = writeVertex(
    'XPMINT_PROVISIONAL',
    task,
    [task.driverId],
    closed.minted
      ? { xp: closed.xp, Ts: closed.Ts, look: closed.look, settleWindow: false }
      : { xp: 0, reason: closed.reason },
    [closeVertex.id],
  );
  mintVertex.xpProvisional = closed.minted ? closed.xp : 0;
  return { closeVertex, mintVertex };
}

export function getVerticesByTask(taskId: string): DagVertex[] {
  return Array.from(vertexStore.values()).filter(v => v.taskId === taskId);
}

export function getAllVertices(): DagVertex[] {
  return Array.from(vertexStore.values());
}
