/**
 * LocalFlow core types.
 *
 * Users never see XP, EP, or DAG terminology. These types are the internal
 * coordination layer that backs the silent empirical data collection.
 */

export type UserId = string;
export type TaskId = string;
export type VertexId = string;

export type UserRole = 'client' | 'driver';

export interface User {
  id: UserId;
  role: UserRole;
  name: string;
  /** geo zone slug, e.g. "maxwell-tx" */
  zone: string;
  createdAt: string;
}

/** What the client sees when making a request */
export type TaskType = 'ride' | 'grocery' | 'errand' | 'recurring';

export interface TaskRequest {
  clientId: UserId;
  type: TaskType;
  description: string;
  /** ISO-8601 */
  requestedBy: string;
  /** max km from client */
  radiusKm: number;
  /** optional recurring schedule (cron-like string) */
  schedule?: string;
}

export type TaskStatus =
  | 'open'
  | 'accepted'
  | 'in_progress'
  | 'completed'
  | 'confirmed'
  | 'disputed'
  | 'settled';

export interface Task {
  id: TaskId;
  clientId: UserId;
  driverId?: UserId;
  type: TaskType;
  description: string;
  status: TaskStatus;
  requestedBy: string;
  acceptedAt?: string;
  completedAt?: string;
  confirmedAt?: string;
  settledAt?: string;
  /** agreed price/notes — set between driver and client directly */
  agreedTerms?: string;
  zone: string;
  /** internal: references to DAG vertices written for this task */
  dagVertices: VertexId[];
}

// ---------------------------------------------------------------------------
// DAG / Extropy Engine internal types
// ---------------------------------------------------------------------------

/**
 * Vertex types that LocalFlow emits.
 * Maps to the canonical Extropy Engine VertexType enum.
 */
export type LocalflowVertexType =
  | 'LOOPOPEN'
  | 'LOOPCLOSE'
  | 'XPMINT_PROVISIONAL'
  | 'XPMINT_CONFIRMED'
  | 'XPBURN'
  | 'LOOPFAILED'
  | 'CONVERGENCE';

/**
 * A DAG vertex written by LocalFlow.
 * Intentionally minimal — the full dag-substrate handles persistence.
 */
export interface DagVertex {
  id: VertexId;
  type: LocalflowVertexType;
  taskId: TaskId;
  actorIds: UserId[];
  payload: Record<string, unknown>;
  lamportTimestamp: number;
  wallTimestamp: string;
  parentVertexIds: VertexId[];
  /** provisional XP value, computed at LOOPCLOSE */
  xpProvisional?: number;
  /** confirmed after 30-day window */
  xpConfirmed?: number;
}

// ---------------------------------------------------------------------------
// XP formula inputs
// ---------------------------------------------------------------------------

/**
 * Inputs required to compute XP for a completed LocalFlow loop.
 * All values must be positive for XP to mint.
 */
export interface XpFormulaInputs {
  /** Rarity: action-class scarcity [0.1, 10.0] */
  R: number;
  /** Frequency-of-decay: anti-grind penalty [0, 1] */
  F: number;
  /** Entropy reduction magnitude — measured coordination improvement */
  deltaS: number;
  /** Domain weight vector (8 elements) */
  w: number[];
  /** Evidence vector (8 elements) */
  E: number[];
  /** Normalized settlement-time factor [Tfloor, 1.0] */
  Ts: number;
}

export interface XpResult {
  xp: number;
  ep: number;
  inputs: XpFormulaInputs;
  /** local merchant loyalty multiplier */
  L: number;
}
