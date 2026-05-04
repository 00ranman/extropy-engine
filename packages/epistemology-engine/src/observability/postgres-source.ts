/**
 * ════════════════════════════════════════════════════════════════════════════════
 *  PostgresSource — EpistemologySource backed by the legacy mesh-state index
 * ════════════════════════════════════════════════════════════════════════════════
 *
 *  Reads from the v3.0 `claims` / `sub_claims` tables plus the v3.1
 *  `bayesian_history` table. The history table is appended every time a
 *  truth_score transitions (see legacy /sub-claims/:id/resolve handler);
 *  this gives us the per-claim time series that drift and falsifiability
 *  computations need.
 *
 *  This source is the v3.1.x source of truth. v3.2 will swap to
 *  DagSubstrateSource once the DAG node read API ships; the queries below
 *  translate cleanly to receipt-stream replays.
 * ════════════════════════════════════════════════════════════════════════════════
 */

import type { Pool } from 'pg';
import type {
  ClaimId,
  SubClaimId,
  EntropyDomain,
  Timestamp,
  BayesianPrior,
} from '@extropy/contracts';
import { betaCI95, ensureBeta } from '../bayesian.js';
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

const HIGH_CONFIDENCE_THRESHOLD = 0.7;

export class PostgresSource implements EpistemologySource {
  readonly kind = 'postgres' as const;
  private readonly pool: Pool;
  private initialized = false;

  constructor(opts: PostgresSourceOptions) {
    this.pool = opts.pool;
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    await this.pool.query('SELECT 1');
    this.initialized = true;
  }

  async close(): Promise<void> {
    // Pool ownership is the caller's, not ours.
    this.initialized = false;
  }

  // ── Validation observations ─────────────────────────────────────────────
  // v3.1.x reads from sub_claims.measurement_ids as a per-claim activity
  // proxy. The dedicated validation_observations table lands in commit 3
  // alongside the validator co-edge graph. Until then this method returns
  // empty; the routes that need it (Sybil) are still 501.
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

  // ── Consensus surface ───────────────────────────────────────────────────
  async getClaimConsensus(claimId: ClaimId): Promise<ClaimConsensusSnapshot | null> {
    this.assertInit();

    const claimRes = await this.pool.query(
      `SELECT id, domain, truth_score, updated_at
         FROM claims
        WHERE id = $1`,
      [claimId],
    );
    if (claimRes.rows.length === 0) return null;
    const claim = claimRes.rows[0] as {
      id: string;
      domain: string;
      truth_score: number;
      updated_at: string | Date;
    };

    const scRes = await this.pool.query(
      `SELECT bayesian_prior, weight, assigned_validator_ids, measurement_ids
         FROM sub_claims
        WHERE claim_id = $1`,
      [claimId],
    );

    let alphaTotal = 0;
    let betaTotal = 0;
    let evidenceMass = 0;
    const probabilities: number[] = [];
    const validatorSet = new Set<string>();

    for (const row of scRes.rows as Array<{
      bayesian_prior: BayesianPrior;
      weight: number;
      assigned_validator_ids: string[];
      measurement_ids: string[];
    }>) {
      const beta = ensureBeta(row.bayesian_prior);
      alphaTotal += beta.alpha * row.weight;
      betaTotal += beta.beta * row.weight;
      const mean = beta.alpha / (beta.alpha + beta.beta);
      probabilities.push(mean);
      evidenceMass += row.measurement_ids.length;
      for (const v of row.assigned_validator_ids ?? []) validatorSet.add(v);
    }

    // Posterior on the claim: weighted-Beta aggregate. Falls back to the
    // stored truth_score when there are no sub-claims (e.g. UNDECIDABLE).
    let posterior: number;
    let credibleInterval: { lo: number; hi: number };
    if (alphaTotal + betaTotal > 0) {
      posterior = alphaTotal / (alphaTotal + betaTotal);
      const [lo, hi] = betaCI95(alphaTotal, betaTotal);
      credibleInterval = { lo, hi };
    } else {
      posterior = claim.truth_score;
      credibleInterval = { lo: 0, hi: 1 };
    }

    // Dissent score: variance of sub-claim posterior means, scaled to [0,1]
    // by the maximum possible variance of a [0,1] random variable (0.25).
    let dissentScore = 0;
    if (probabilities.length >= 2) {
      const mean = probabilities.reduce((s, p) => s + p, 0) / probabilities.length;
      const variance =
        probabilities.reduce((s, p) => s + (p - mean) * (p - mean), 0) / probabilities.length;
      dissentScore = Math.min(variance / 0.25, 1);
    }

    return {
      claimId: claim.id as ClaimId,
      domain: claim.domain as EntropyDomain,
      posterior,
      credibleInterval,
      validatorCount: validatorSet.size,
      evidenceMass,
      dissentScore,
      observedAt: toIso(claim.updated_at),
    };
  }

  async listConsensusDrift(
    filter: MeshFilter & { minDelta?: number; limit?: number },
  ): Promise<
    Array<{ claimId: ClaimId; previous: number; current: number; observedAt: Timestamp }>
  > {
    this.assertInit();
    const minDelta = filter.minDelta ?? 0.1;
    const limit = Math.min(filter.limit ?? 100, 1000);
    const params: unknown[] = [minDelta, limit];
    const conds: string[] = [
      `previous_score IS NOT NULL`,
      `ABS(current_score - previous_score) >= $1`,
    ];
    if (filter.domain) {
      params.push(filter.domain);
      conds.push(`domain = $${params.length}`);
    }
    if (filter.range?.from) {
      params.push(filter.range.from);
      conds.push(`observed_at >= $${params.length}`);
    }
    if (filter.range?.to) {
      params.push(filter.range.to);
      conds.push(`observed_at <= $${params.length}`);
    }

    const sql = `
      SELECT claim_id, previous_score, current_score, observed_at
        FROM bayesian_history
       WHERE ${conds.join(' AND ')}
       ORDER BY observed_at DESC
       LIMIT $2
    `;
    const { rows } = await this.pool.query(sql, params);
    return rows.map(
      (r: {
        claim_id: string;
        previous_score: number;
        current_score: number;
        observed_at: string | Date;
      }) => ({
        claimId: r.claim_id as ClaimId,
        previous: r.previous_score,
        current: r.current_score,
        observedAt: toIso(r.observed_at),
      }),
    );
  }

  // ── Falsifiability ──────────────────────────────────────────────────────
  async computeFalsifiability(filter: MeshFilter): Promise<FalsifiabilityStat> {
    this.assertInit();

    const params: unknown[] = [];
    const conds: string[] = [];
    if (filter.domain) {
      params.push(filter.domain);
      conds.push(`domain = $${params.length}`);
    }
    if (filter.range?.from) {
      params.push(filter.range.from);
      conds.push(`observed_at >= $${params.length}`);
    }
    if (filter.range?.to) {
      params.push(filter.range.to);
      conds.push(`observed_at <= $${params.length}`);
    }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';

    // claimCount: distinct claims observed in window.
    // posteriorDelta: mean signed delta across rows that have a previous_score.
    // flips: rows where the score crossed the 0.5 line.
    // highConfidenceRefutations: rows where previous_score > HIGH_CONFIDENCE
    //   and current_score dropped at least 0.2.
    const sql = `
      SELECT
        COUNT(DISTINCT claim_id)::int                                          AS claim_count,
        COALESCE(AVG(current_score - previous_score) FILTER (WHERE previous_score IS NOT NULL), 0)::float AS posterior_delta,
        COUNT(*) FILTER (
          WHERE previous_score IS NOT NULL
            AND ((previous_score >= 0.5 AND current_score < 0.5)
              OR (previous_score < 0.5 AND current_score >= 0.5))
        )::int                                                                 AS flips,
        COUNT(*) FILTER (
          WHERE previous_score IS NOT NULL
            AND previous_score > $${params.length + 1}
            AND (previous_score - current_score) >= 0.2
        )::int                                                                 AS high_conf_refutations
      FROM bayesian_history
      ${where}
    `;
    params.push(HIGH_CONFIDENCE_THRESHOLD);

    const { rows } = await this.pool.query(sql, params);
    const r = rows[0] as {
      claim_count: number;
      posterior_delta: number;
      flips: number;
      high_conf_refutations: number;
    };

    return {
      domain: (filter.domain ?? ('COGNITIVE' as EntropyDomain)) as EntropyDomain,
      dfaoId: filter.dfaoId,
      range: filter.range ?? {},
      claimCount: r.claim_count,
      flips: r.flips,
      posteriorDelta: r.posterior_delta,
      highConfidenceRefutations: r.high_conf_refutations,
      // The route layer reweights this. We expose the raw component score
      // so downstream weighting is policy-owned by falsifiability.ts.
      score: 0,
    };
  }

  // ── Validator graph (Sybil + reputation inputs) ─────────────────────────
  // Wired in commit 3 alongside the validation_observations table.
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

function toIso(v: string | Date): Timestamp {
  if (v instanceof Date) return v.toISOString();
  return new Date(v).toISOString();
}
