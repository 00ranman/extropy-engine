/**
 * LocalFlow core types.
 *
 * Users never see XP, EP, or DAG terminology. These types are the internal
 * coordination layer that backs the silent empirical data collection.
 *
 * Measurement integrity note: LocalFlow captures RAW observables (expected
 * vs. actual duration, completion status, timestamps, confirmation metadata).
 * It does NOT itself derive a normalized entropy delta (deltaS_be). The
 * canonical M_d normalization is out of scope here and must be supplied by a
 * validated normalized measurement. See measurement.ts and simulation.ts.
 */

import { EntropyDomain, VertexType } from '@extropy/contracts';
import type { MeasurementSource } from '@extropy/contracts';
import type { XPFormulaInputs } from '@extropy/xp-formula';

export { EntropyDomain, VertexType } from '@extropy/contracts';
export type { MeasurementSource } from '@extropy/contracts';
export type { XPFormulaInputs } from '@extropy/xp-formula';

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
  /**
   * Raw baseline observable captured at request opening: the duration or wait
   * the client expects this coordination to take, in seconds. This is a raw
   * observable, NOT an entropy value.
   */
  expectedDurationSeconds?: number;
  /**
   * Canonical entropy domain this coordination work belongs to. Must be one of
   * the eight canonical domains. LocalFlow work is typically economic or
   * temporal.
   */
  domain?: EntropyDomain;
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
  /** agreed price/notes - set between driver and client directly */
  agreedTerms?: string;
  zone: string;
  /** Raw baseline observable captured at open (see TaskRequest). */
  expectedDurationSeconds?: number;
  /** Canonical entropy domain for this coordination work. */
  domain?: EntropyDomain;
  /** internal: references to DAG vertices written for this task */
  dagVertices: VertexId[];
}

// ---------------------------------------------------------------------------
// Raw measurement evidence (baseline vs. outcome)
// ---------------------------------------------------------------------------

/**
 * Raw baseline evidence captured at request opening.
 *
 * These are raw observables about the expected coordination, not an entropy
 * measurement. They exist so that a downstream normalization step can compare
 * baseline against outcome. LocalFlow never converts these into deltaS_be.
 */
export interface CoordinationBaseline {
  /** Expected duration or wait the client anticipated, in seconds. */
  expectedDurationSeconds?: number;
  /** ISO-8601 timestamp when the baseline was captured (request opening). */
  capturedAt: string;
  /** Where this baseline came from (client input, prior history, etc.). */
  source: MeasurementSource;
}

/**
 * Independent confirmation metadata.
 *
 * LocalFlow does NOT fabricate independent confirmations. It only records
 * whether one was presented and by whom, so a downstream validator can decide
 * whether the outcome is trustworthy. `confirmed: false` is the honest default
 * when no independent party has confirmed.
 */
export interface IndependentConfirmation {
  /** True only when a party other than the acting driver confirmed. */
  confirmed: boolean;
  /** The confirming party, if any. Never the acting driver alone. */
  confirmerId?: UserId;
  /** How the confirmation was obtained (e.g. "client_confirm", "receipt"). */
  method?: string;
  /** ISO-8601 timestamp of the confirmation, if any. */
  confirmedAt?: string;
}

/**
 * Raw outcome evidence captured at closing.
 *
 * All fields are raw observables. `actualDurationSeconds` is elapsed wall time
 * and is explicitly NOT a normalized settlement-time factor and NOT deltaS.
 */
export interface CoordinationOutcome {
  /** Actual elapsed duration from open to close, in seconds (raw wall time). */
  actualDurationSeconds: number;
  /** Whether the coordination completed or failed. */
  completionStatus: 'completed' | 'failed';
  /** ISO-8601 timestamp the loop opened. */
  openedAt: string;
  /** ISO-8601 timestamp the loop closed. */
  closedAt: string;
  /**
   * Resource-usage observables, where representable. Left open because
   * LocalFlow only records what it can actually observe; it does not invent
   * fields it cannot fill.
   */
  resourceUsage?: Record<string, number>;
  /** Independent confirmation metadata (presence only, never fabricated). */
  independentConfirmation: IndependentConfirmation;
  /** Where this outcome evidence came from. */
  source: MeasurementSource;
}

/**
 * Explicit normalization status for a measurement record.
 *   - 'unavailable': no validated normalization exists (honest default).
 *   - 'pending': normalization has been requested but not yet validated.
 *   - 'normalized': a validated normalized measurement is attached.
 */
export type NormalizationStatus = 'unavailable' | 'pending' | 'normalized';

/**
 * A validated, normalized measurement supplied by an external normalization
 * step (a validator or, for demos only, the simulation adapter).
 *
 * LocalFlow does not compute these. It only carries and validates them. The
 * canonical XP formula inputs (R, F, deltaS, w, E, Ts) are provided here as
 * already-normalized values so LocalFlow never invents M_d, coefficients, or
 * weights on the production path.
 */
export interface NormalizedMeasurement {
  domain: EntropyDomain;
  /** Canonical, already-normalized XP formula inputs. */
  inputs: XPFormulaInputs;
  /** Identifier of the party that produced the normalization. */
  normalizedBy: string;
  /** True when this normalization was produced by the simulation adapter. */
  simulated: boolean;
  /** ISO-8601 timestamp of normalization. */
  normalizedAt: string;
}

/**
 * Canonical measurement record. Serves as the MEASUREMENT vertex payload
 * (see VertexType.MEASUREMENT in @extropy/contracts). Stores baseline,
 * outcome, evidence provenance, and an explicit normalization status.
 */
export interface CoordinationMeasurementRecord {
  taskId: TaskId;
  domain: EntropyDomain;
  baseline: CoordinationBaseline;
  outcome: CoordinationOutcome;
  normalizationStatus: NormalizationStatus;
  /** Present only when normalizationStatus === 'normalized'. */
  normalized?: NormalizedMeasurement;
}

// ---------------------------------------------------------------------------
// DAG / Extropy Engine internal types
// ---------------------------------------------------------------------------

/**
 * Vertex types that LocalFlow emits.
 * Maps to the canonical Extropy Engine VertexType enum via CANONICAL_VERTEX_TYPE.
 */
export type LocalflowVertexType =
  | 'LOOPOPEN'
  | 'LOOPCLOSE'
  | 'MEASUREMENT'
  | 'XPMINT_PROVISIONAL'
  | 'XPMINT_CONFIRMED'
  | 'XPBURN'
  | 'LOOPFAILED'
  | 'CONVERGENCE';

/**
 * Maps LocalFlow lifecycle vertex types to canonical VertexType values so the
 * emitted vertices join the canonical ontology rather than a parallel one.
 * Types without a direct canonical equivalent fall back to GENERIC.
 */
export const CANONICAL_VERTEX_TYPE: Record<LocalflowVertexType, VertexType> = {
  LOOPOPEN: VertexType.LOOP_OPEN,
  LOOPCLOSE: VertexType.LOOP_CLOSE,
  MEASUREMENT: VertexType.MEASUREMENT,
  XPMINT_PROVISIONAL: VertexType.XP_MINT,
  XPMINT_CONFIRMED: VertexType.XP_MINT,
  XPBURN: VertexType.TOKEN_BURN,
  LOOPFAILED: VertexType.GENERIC,
  CONVERGENCE: VertexType.GENERIC,
};

/**
 * A DAG vertex written by LocalFlow.
 * Intentionally minimal - the full dag-substrate handles persistence.
 */
export interface DagVertex {
  id: VertexId;
  type: LocalflowVertexType;
  /** Canonical VertexType this vertex maps to. */
  canonicalType: VertexType;
  taskId: TaskId;
  actorIds: UserId[];
  payload: Record<string, unknown>;
  lamportTimestamp: number;
  wallTimestamp: string;
  parentVertexIds: VertexId[];
  /** provisional XP value, computed at XPMINT_PROVISIONAL */
  xpProvisional?: number;
  /** confirmed after 30-day window */
  xpConfirmed?: number;
}

// ---------------------------------------------------------------------------
// XP result
// ---------------------------------------------------------------------------

export interface XpResult {
  xp: number;
  ep: number;
  inputs: XPFormulaInputs;
  /** local merchant loyalty multiplier */
  L: number;
  /** canonical formula version that produced this result */
  formulaVersion: string;
}
