/**
 * ════════════════════════════════════════════════════════════════════════════════
 *  PostgresSource — EpistemologySource backed by the legacy mesh-state index
 * ════════════════════════════════════════════════════════════════════════════════
 *
 *  This is a SCAFFOLD. The real query bodies depend on the v3.0 schema, which
 *  is captured separately in scripts/schema/epistemology.sql (TBD as part of
 *  the v3.1.x rollout). Each method below documents the query shape it will
 *  run; the bodies return placeholder empties so the routes can wire up
 *  without blocking. Wiring lands in commit 2 alongside `/mesh/consensus` and
 *  `/mesh/falsifiability`.
 *
 *  The point of merging this in commit 1 is to LOCK THE INTERFACE. Other
 *  packages that consume the observability surface (dashboard, governance,
 *  reputation graph) can develop against this contract today. Replacing the
 *  empty bodies with real SQL is a strictly additive change.
 * ════════════════════════════════════════════════════════════════════════════════
 */

import type { Pool } from 'pg';
import type { ClaimId, SubClaimId, EntropyDomain, Timestamp } from '@extropy/contracts';
import type {
  EpistemologySource,
  MeshFilter,
  ValidationObservation,
  ClaimConsensusSnapshot,
  FalsifiabilityStat,
  ValidatorCoEdge,
} from './source.js';

export interface PostgresSourceOptions {
  pool: Pool;
}

export class PostgresSource implements EpistemologySource {
  readonly kind = 'postgres' as const;
  private readonly pool: Pool;
  private initialized = false;

  constructor(opts: PostgresSourceOptions) {
    this.pool = opts.pool;
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    // Sanity ping. Real implementations will also verify expected schema version.
    await this.pool.query('SELECT 1');
    this.initialized = true;
  }

  async close(): Promise<void> {
    // Pool ownership is the caller's, not ours. We do not end the pool here.
    this.initialized = false;
  }

  /**
   *  Target query (v3.1.x):
   *
   *    SELECT sub_claim_id, claim_id, validator_did, domain,
   *           evidence_confidence, counter_confidence,
   *           observed_at, dag_receipt_digest
   *      FROM validation_observations
   *     WHERE ($1::text IS NULL OR domain = $1)
   *       AND ($2::text IS NULL OR dfao_id = $2)
   *       AND ($3::text IS NULL OR claim_id = $3)
   *       ...
   *     ORDER BY observed_at DESC
   *     LIMIT $N;
   */
  async listValidationObservations(
    _filter: MeshFilter & {
      claimId?: ClaimId;
      subClaimId?: SubClaimId;
      validatorDid?: string;
      limit?: number;
    },
  ): Promise<ValidationObservation[]> {
    this.assertInit();
    return [];
  }

  /**
   *  Target query: aggregate by claim_id from validation_observations and
   *  the bayesian_state table that tracks (alpha, beta) posteriors.
   */
  async getClaimConsensus(_claimId: ClaimId): Promise<ClaimConsensusSnapshot | null> {
    this.assertInit();
    return null;
  }

  /**
   *  Target query: window function over bayesian_state ordered by updated_at
   *  per claim_id, filtering rows where |posterior_now - posterior_prev|
   *  exceeds the threshold.
   */
  async listConsensusDrift(): Promise<
    Array<{ claimId: ClaimId; previous: number; current: number; observedAt: Timestamp }>
  > {
    this.assertInit();
    return [];
  }

  /**
   *  Target computation: count claims, refutation flips, and the mean
   *  posterior delta in the window. Score = computeFalsifiabilityScore() —
   *  see observability/falsifiability.ts (commit 2).
   */
  async computeFalsifiability(filter: MeshFilter): Promise<FalsifiabilityStat> {
    this.assertInit();
    return {
      domain: (filter.domain ?? 'COGNITIVE') as EntropyDomain,
      dfaoId: filter.dfaoId,
      range: filter.range ?? {},
      claimCount: 0,
      flips: 0,
      posteriorDelta: 0,
      highConfidenceRefutations: 0,
      score: 0,
    };
  }

  /**
   *  Target query: self-join validation_observations on sub_claim_id where
   *  validator_did pairs differ and observed_at is within a co-validation
   *  window (default 24h), grouped to weighted edges.
   */
  async listValidatorCoEdges(): Promise<ValidatorCoEdge[]> {
    this.assertInit();
    return [];
  }

  async listValidatorDids(): Promise<string[]> {
    this.assertInit();
    return [];
  }

  private assertInit(): void {
    if (!this.initialized) {
      throw new Error('PostgresSource: init() must be called before queries');
    }
  }
}
