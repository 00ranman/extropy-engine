/**
 * ════════════════════════════════════════════════════════════════════════════════
 *  EpistemologySource — pluggable read backend for the observability layer
 * ════════════════════════════════════════════════════════════════════════════════
 *
 *  The epistemology engine is a READ-MOSTLY observability surface over the
 *  mesh's emergent peer-review system. Validation, decomposition, and truth
 *  arbitration happen elsewhere: validation in DFAOs, decomposition on the
 *  participant's personal AI, truth in the consensus that emerges from
 *  incentive-aligned validators. This package only witnesses what the mesh
 *  produces.
 *
 *  Two backends ship in v3.1.x:
 *
 *    PostgresSource       — reads the legacy mesh-state index that the v3.0
 *                           service populated. Stable, queryable, fast for
 *                           historical analytics. Source of truth for v3.1.x.
 *
 *    DagSubstrateSource   — reads directly from the DAG substrate (the layered
 *                           mesh of DFAO smart contracts forming the foundational
 *                           write-target of every claim, validation, and reveal).
 *                           Source of truth for v3.2 once the DAG node API is
 *                           stable. v3.1 ships a stub that throws on every call
 *                           with a clear "not yet wired" message — the routes
 *                           are written against the interface so the swap is a
 *                           one-line config flip.
 *
 *  The interface is deliberately small. Callers ask for OBSERVATIONS, not for
 *  authoritative truth claims. Every method returns either witnessed state or
 *  aggregations of witnessed state. None of them "decide" anything.
 *
 *  Design notes:
 *
 *    - Every method is async. Postgres queries and DAG reads both block on I/O.
 *    - All filters are optional; an empty filter means "across the entire mesh".
 *    - Time ranges are ISO 8601 strings. Inclusive on both ends. UTC.
 *    - DIDs are typed as strings here. The identity package owns the
 *      did:extropy:<hex> shape; we treat them opaquely so this interface stays
 *      decoupled from identity internals.
 *    - Domains are `EntropyDomain` from @extropy/contracts. Crossing the
 *      domain boundary means a different physical metric and a different
 *      causal closure speed (see CAUSAL_CLOSURE_SPEEDS).
 *    - "Validator" here means any participant who emitted a validation
 *      outcome on a sub-claim. The DID is the key. Reputation is computed
 *      separately by the reputation graph.
 *
 *  The interface MUST stay backend-agnostic. Anything that smells like
 *  Postgres-only (SQL fragments, pg.Pool, Redis keys) lives in the
 *  implementation files, never here.
 * ════════════════════════════════════════════════════════════════════════════════
 */

import type {
  ClaimId,
  SubClaimId,
  ValidatorId,
  EntropyDomain,
  Timestamp,
} from '@extropy/contracts';

// ─────────────────────────────────────────────────────────────────────────────
//  Shared filter shapes
// ─────────────────────────────────────────────────────────────────────────────

export interface TimeRange {
  /** ISO 8601, inclusive. Omit for "since the beginning of time the engine knows about". */
  from?: Timestamp;
  /** ISO 8601, inclusive. Omit for "now". */
  to?: Timestamp;
}

export interface MeshFilter {
  domain?: EntropyDomain;
  /** DFAO id. Empty = all DFAOs. */
  dfaoId?: string;
  range?: TimeRange;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Observation shapes
// ─────────────────────────────────────────────────────────────────────────────

/**
 *  A single witnessed validation outcome on a sub-claim. The mesh produces
 *  millions of these. The observability layer aggregates them.
 */
export interface ValidationObservation {
  subClaimId: SubClaimId;
  claimId: ClaimId;
  validatorDid: string;
  domain: EntropyDomain;
  /** Validator's confidence the sub-claim is true, in [0, 1]. */
  evidenceConfidence: number;
  /** Optional refutation weight, in [0, 1]. Mutually exclusive with evidenceConfidence in practice but stored together for legacy. */
  counterConfidence?: number;
  observedAt: Timestamp;
  /** Hash of the validation receipt on the DAG. Empty if read from a non-DAG backend. */
  dagReceiptDigest?: string;
}

/**
 *  Aggregated consensus state for one claim, witnessed over a time window.
 *  Returned by `getClaimConsensus`. Not authoritative — informational only.
 */
export interface ClaimConsensusSnapshot {
  claimId: ClaimId;
  domain: EntropyDomain;
  /** Posterior probability the claim is true under the Beta(α,β) aggregator. */
  posterior: number;
  /** 95% credible interval on the posterior. */
  credibleInterval: { lo: number; hi: number };
  /** Number of distinct validators who weighed in. */
  validatorCount: number;
  /** Sum of evidence confidences. Useful for spotting low-data claims. */
  evidenceMass: number;
  /** Spread of validator confidences. High = contested, low = settled. */
  dissentScore: number;
  observedAt: Timestamp;
}

/**
 *  Falsifiability statistic for a (domain, dfao, window) cell.
 *  A high refutation rate against high-confidence claims is a HEALTH signal —
 *  it means the mesh is willing to overturn confident claims when warranted.
 *  A near-zero rate may indicate validator capture or claim conformity bias.
 */
export interface FalsifiabilityStat {
  domain: EntropyDomain;
  dfaoId?: string;
  range: TimeRange;
  /** Total claims observed in window. */
  claimCount: number;
  /** Claims that flipped from VERIFIED → REFUTED or vice versa within the window. */
  flips: number;
  /** Mean change in posterior across the window. */
  posteriorDelta: number;
  /** Count of refutation receipts whose target claim previously had posterior > 0.7. */
  highConfidenceRefutations: number;
  /** Aggregate falsifiability score in [0, 1]; production formula TBD, see falsifiability.ts. */
  score: number;
}

/**
 *  One node in the validator-collaboration graph. Edges are co-validation
 *  events on the same sub-claim within a short time window. Used by Sybil
 *  cluster detection (see sybil.ts).
 */
export interface ValidatorCoEdge {
  fromDid: string;
  toDid: string;
  /** Number of co-validation events. */
  weight: number;
  /** Last observed co-validation. */
  lastObservedAt: Timestamp;
}

// ─────────────────────────────────────────────────────────────────────────────
//  EpistemologySource interface
// ─────────────────────────────────────────────────────────────────────────────

export interface EpistemologySource {
  /** Identifier for logging, error messages, /health output. */
  readonly kind: 'postgres' | 'dag-substrate';

  /** Lifecycle. Idempotent. */
  init(): Promise<void>;
  close(): Promise<void>;

  // ── Validation observations ─────────────────────────────────────────────
  listValidationObservations(filter: MeshFilter & {
    claimId?: ClaimId;
    subClaimId?: SubClaimId;
    validatorDid?: string;
    limit?: number;
  }): Promise<ValidationObservation[]>;

  // ── Consensus surface ───────────────────────────────────────────────────
  getClaimConsensus(claimId: ClaimId): Promise<ClaimConsensusSnapshot | null>;

  listConsensusDrift(filter: MeshFilter & {
    /** Minimum |posterior_now - posterior_prev| to include. Default 0.1. */
    minDelta?: number;
    limit?: number;
  }): Promise<Array<{ claimId: ClaimId; previous: number; current: number; observedAt: Timestamp }>>;

  // ── Falsifiability ──────────────────────────────────────────────────────
  computeFalsifiability(filter: MeshFilter): Promise<FalsifiabilityStat>;

  // ── Validator graph (Sybil + reputation inputs) ─────────────────────────
  listValidatorCoEdges(filter: MeshFilter & {
    /** Restrict to edges incident on this DID. */
    seedDid?: string;
    minWeight?: number;
    limit?: number;
  }): Promise<ValidatorCoEdge[]>;

  /**
   *  All distinct validator DIDs observed in the filter window. Used as the
   *  vertex set for the random-walk Sybil ranking.
   */
  listValidatorDids(filter: MeshFilter): Promise<string[]>;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Configuration
// ─────────────────────────────────────────────────────────────────────────────

export type EpistemologyBackend = 'postgres' | 'dag-substrate';

export function selectBackend(env: NodeJS.ProcessEnv = process.env): EpistemologyBackend {
  const raw = (env.EPISTEMOLOGY_SOURCE ?? 'postgres').toLowerCase();
  if (raw === 'postgres' || raw === 'dag-substrate') return raw;
  throw new Error(
    `Unknown EPISTEMOLOGY_SOURCE='${raw}'. Expected 'postgres' or 'dag-substrate'.`,
  );
}
