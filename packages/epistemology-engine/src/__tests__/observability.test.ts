/**
 *  Tests for the v3.1 observability scaffold + commit 2 query bodies.
 *
 *  These tests exercise:
 *
 *    1. selectBackend() environment parsing.
 *    2. DagSubstrateSource throws DagSubstrateNotWiredError on every read.
 *    3. PostgresSource enforces init() before queries.
 *    4. PostgresSource.getClaimConsensus aggregates Beta(α, β) sub-claims.
 *    5. PostgresSource.listConsensusDrift binds parameters and filter conds.
 *    6. PostgresSource.computeFalsifiability shape matches FalsifiabilityStat.
 *    7. Mesh router routes (/source, /consensus/:id, /consensus/drift,
 *       /falsifiability) return real handler shapes; /sybil/rank still 501.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import express, { type Express } from 'express';
import {
  selectBackend,
  DagSubstrateSource,
  DagSubstrateNotWiredError,
  PostgresSource,
} from '../observability/index.js';
import { createMeshRouter } from '../routes/mesh/index.js';

// ─────────────────────────────────────────────────────────────────────────────
//  Fake Pool — records every query and returns canned rows by SQL fragment.
// ─────────────────────────────────────────────────────────────────────────────
//  We match on a SQL substring so we don't have to escape Postgres syntax.
//  First matching pattern wins. Patterns are checked in registration order.

interface PoolCall {
  sql: string;
  params: unknown[];
}

interface PatternedResponse {
  match: string;
  rows: unknown[];
}

function makeFakePool(patterns: PatternedResponse[]): {
  pool: import('pg').Pool;
  calls: PoolCall[];
} {
  const calls: PoolCall[] = [];
  const pool = {
    query: async (sql: string, params?: unknown[]) => {
      calls.push({ sql, params: params ?? [] });
      for (const p of patterns) {
        if (sql.includes(p.match)) return { rows: p.rows };
      }
      return { rows: [] };
    },
  } as unknown as import('pg').Pool;
  return { pool, calls };
}

// ─────────────────────────────────────────────────────────────────────────────
//  selectBackend
// ─────────────────────────────────────────────────────────────────────────────

describe('selectBackend', () => {
  it('defaults to postgres when env is unset', () => {
    expect(selectBackend({})).toBe('postgres');
  });

  it('respects EPISTEMOLOGY_SOURCE=dag-substrate', () => {
    expect(selectBackend({ EPISTEMOLOGY_SOURCE: 'dag-substrate' })).toBe('dag-substrate');
  });

  it('throws on unknown source', () => {
    expect(() => selectBackend({ EPISTEMOLOGY_SOURCE: 'mongo' })).toThrow(/Unknown/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
//  DagSubstrateSource
// ─────────────────────────────────────────────────────────────────────────────

describe('DagSubstrateSource', () => {
  it('init does not throw, reads do', async () => {
    const s = new DagSubstrateSource();
    await s.init();
    await expect(s.listValidationObservations({})).rejects.toBeInstanceOf(
      DagSubstrateNotWiredError,
    );
    await expect(s.computeFalsifiability({})).rejects.toBeInstanceOf(DagSubstrateNotWiredError);
    await expect(s.listValidatorDids({})).rejects.toBeInstanceOf(DagSubstrateNotWiredError);
  });

  it('refuses queries before init', async () => {
    const s = new DagSubstrateSource();
    await expect(s.listValidationObservations({})).rejects.toThrow(/init/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
//  PostgresSource
// ─────────────────────────────────────────────────────────────────────────────

describe('PostgresSource', () => {
  it('refuses queries before init', async () => {
    const { pool } = makeFakePool([]);
    const s = new PostgresSource({ pool });
    await expect(s.listValidationObservations({})).rejects.toThrow(/init/);
  });

  it('init runs SELECT 1', async () => {
    const { pool, calls } = makeFakePool([]);
    const s = new PostgresSource({ pool });
    await s.init();
    expect(calls[0].sql).toContain('SELECT 1');
  });

  describe('getClaimConsensus', () => {
    it('returns null when claim does not exist', async () => {
      const { pool } = makeFakePool([
        { match: 'FROM claims', rows: [] },
      ]);
      const s = new PostgresSource({ pool });
      await s.init();
      const snap = await s.getClaimConsensus('claim-missing' as never);
      expect(snap).toBeNull();
    });

    it('aggregates Beta(α, β) priors across sub-claims', async () => {
      // Two sub-claims, both weight 1.
      // SC1: Beta(8, 2) → mean 0.8
      // SC2: Beta(2, 8) → mean 0.2
      // Aggregate: alpha=10, beta=10 → posterior 0.5
      // Probabilities=[0.8, 0.2] → variance 0.09 → dissent = 0.09/0.25 = 0.36
      const { pool } = makeFakePool([
        {
          match: 'FROM claims',
          rows: [
            {
              id: 'claim-1',
              domain: 'COGNITIVE',
              truth_score: 0.5,
              updated_at: new Date('2026-01-01T00:00:00Z'),
            },
          ],
        },
        {
          match: 'FROM sub_claims',
          rows: [
            {
              bayesian_prior: { alpha: 8, beta: 2, version: 1 },
              weight: 1,
              assigned_validator_ids: ['v1', 'v2'],
              measurement_ids: ['m1', 'm2'],
            },
            {
              bayesian_prior: { alpha: 2, beta: 8, version: 1 },
              weight: 1,
              assigned_validator_ids: ['v2', 'v3'],
              measurement_ids: ['m3'],
            },
          ],
        },
      ]);
      const s = new PostgresSource({ pool });
      await s.init();
      const snap = await s.getClaimConsensus('claim-1' as never);
      expect(snap).not.toBeNull();
      expect(snap!.claimId).toBe('claim-1');
      expect(snap!.posterior).toBeCloseTo(0.5, 5);
      expect(snap!.credibleInterval.lo).toBeGreaterThan(0);
      expect(snap!.credibleInterval.hi).toBeLessThan(1);
      expect(snap!.credibleInterval.lo).toBeLessThan(snap!.credibleInterval.hi);
      expect(snap!.validatorCount).toBe(3); // v1, v2, v3 unique
      expect(snap!.evidenceMass).toBe(3); // 2 + 1 measurements
      expect(snap!.dissentScore).toBeCloseTo(0.36, 2);
    });

    it('falls back to truth_score when claim has no sub-claims', async () => {
      const { pool } = makeFakePool([
        {
          match: 'FROM claims',
          rows: [
            {
              id: 'claim-2',
              domain: 'BIOLOGICAL',
              truth_score: 0.42,
              updated_at: '2026-02-01T00:00:00Z',
            },
          ],
        },
        { match: 'FROM sub_claims', rows: [] },
      ]);
      const s = new PostgresSource({ pool });
      await s.init();
      const snap = await s.getClaimConsensus('claim-2' as never);
      expect(snap!.posterior).toBe(0.42);
      expect(snap!.credibleInterval).toEqual({ lo: 0, hi: 1 });
      expect(snap!.dissentScore).toBe(0);
      expect(snap!.validatorCount).toBe(0);
    });
  });

  describe('listConsensusDrift', () => {
    it('binds minDelta + limit + domain + range params in order', async () => {
      const { pool, calls } = makeFakePool([
        {
          match: 'FROM bayesian_history',
          rows: [
            {
              claim_id: 'claim-x',
              previous_score: 0.4,
              current_score: 0.7,
              observed_at: new Date('2026-03-01T00:00:00Z'),
            },
          ],
        },
      ]);
      const s = new PostgresSource({ pool });
      await s.init();
      const drifts = await s.listConsensusDrift({
        minDelta: 0.2,
        limit: 50,
        domain: 'COGNITIVE' as never,
        range: { from: '2026-01-01T00:00:00Z', to: '2026-04-01T00:00:00Z' },
      });
      expect(drifts).toHaveLength(1);
      expect(drifts[0].claimId).toBe('claim-x');
      expect(drifts[0].previous).toBe(0.4);
      expect(drifts[0].current).toBe(0.7);
      expect(drifts[0].observedAt).toBe('2026-03-01T00:00:00.000Z');
      // The query call should include all four params in the order:
      // [minDelta, limit, domain, from, to]
      const driftCall = calls.find((c) => c.sql.includes('FROM bayesian_history'))!;
      expect(driftCall.params).toEqual([
        0.2,
        50,
        'COGNITIVE',
        '2026-01-01T00:00:00Z',
        '2026-04-01T00:00:00Z',
      ]);
      expect(driftCall.sql).toContain('domain = $3');
      expect(driftCall.sql).toContain('observed_at >= $4');
      expect(driftCall.sql).toContain('observed_at <= $5');
    });

    it('uses default minDelta and limit when omitted', async () => {
      const { pool, calls } = makeFakePool([
        { match: 'FROM bayesian_history', rows: [] },
      ]);
      const s = new PostgresSource({ pool });
      await s.init();
      await s.listConsensusDrift({});
      const driftCall = calls.find((c) => c.sql.includes('FROM bayesian_history'))!;
      expect(driftCall.params[0]).toBe(0.1);
      expect(driftCall.params[1]).toBe(100);
    });
  });

  describe('computeFalsifiability', () => {
    it('passes through aggregate counts and HIGH_CONFIDENCE threshold', async () => {
      const { pool, calls } = makeFakePool([
        {
          match: 'FROM bayesian_history',
          rows: [
            {
              claim_count: 25,
              posterior_delta: 0.05,
              flips: 4,
              high_conf_refutations: 2,
            },
          ],
        },
      ]);
      const s = new PostgresSource({ pool });
      await s.init();
      const stat = await s.computeFalsifiability({ domain: 'COGNITIVE' as never });
      expect(stat.claimCount).toBe(25);
      expect(stat.flips).toBe(4);
      expect(stat.highConfidenceRefutations).toBe(2);
      expect(stat.posteriorDelta).toBeCloseTo(0.05);
      expect(stat.score).toBe(0); // route layer reweights
      // The HIGH_CONFIDENCE threshold (0.7) is bound as the last param.
      const fcall = calls.find((c) => c.sql.includes('high_conf_refutations'))!;
      expect(fcall.params[fcall.params.length - 1]).toBe(0.7);
    });
  });

  it('listValidatorCoEdges and listValidatorDids return [] until commit 3', async () => {
    const { pool } = makeFakePool([]);
    const s = new PostgresSource({ pool });
    await s.init();
    expect(await s.listValidatorCoEdges({})).toEqual([]);
    expect(await s.listValidatorDids({})).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
//  Mesh router (commit 2 endpoints live)
// ─────────────────────────────────────────────────────────────────────────────

describe('mesh router', () => {
  let app: Express;
  let baseUrl: string;
  let server: ReturnType<Express['listen']>;

  beforeAll(async () => {
    const { pool } = makeFakePool([
      {
        match: 'FROM claims',
        rows: [
          {
            id: 'claim-route',
            domain: 'COGNITIVE',
            truth_score: 0.62,
            updated_at: new Date('2026-04-01T00:00:00Z'),
          },
        ],
      },
      {
        match: 'FROM sub_claims',
        rows: [
          {
            bayesian_prior: { alpha: 6, beta: 4, version: 1 },
            weight: 1,
            assigned_validator_ids: ['v1'],
            measurement_ids: ['m1'],
          },
        ],
      },
      {
        match: 'FROM bayesian_history',
        rows: [
          {
            // For computeFalsifiability — single aggregate row.
            claim_count: 12,
            posterior_delta: 0.1,
            flips: 1,
            high_conf_refutations: 0,
            // For listConsensusDrift — different shape, won't match anyway
            // because that route is not exercised in the route block below.
          },
        ],
      },
    ]);
    const source = new PostgresSource({ pool });
    await source.init();
    app = express();
    app.use(express.json());
    app.use('/mesh', createMeshRouter({ source }));

    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => resolve());
    });
    const addr = server.address();
    if (!addr || typeof addr === 'string') throw new Error('no address');
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  it('reports the active source kind', async () => {
    const r = await fetch(`${baseUrl}/mesh/source`);
    expect(r.status).toBe(200);
    const json = await r.json();
    expect(json.kind).toBe('postgres');
  });

  it('GET /mesh/consensus/:claimId returns a snapshot', async () => {
    const r = await fetch(`${baseUrl}/mesh/consensus/claim-route`);
    expect(r.status).toBe(200);
    const json = await r.json();
    expect(json.claimId).toBe('claim-route');
    expect(json.posterior).toBeCloseTo(0.6, 5);
    expect(json.credibleInterval.lo).toBeGreaterThan(0);
    expect(json.credibleInterval.hi).toBeLessThan(1);
  });

  it('GET /mesh/falsifiability returns scored stat with interpretation', async () => {
    const r = await fetch(`${baseUrl}/mesh/falsifiability?domain=COGNITIVE`);
    expect(r.status).toBe(200);
    const json = await r.json();
    expect(json.weights).toEqual({
      highConfidenceRefutations: 0.5,
      flips: 0.3,
      posteriorDelta: 0.2,
    });
    expect(json.stat.claimCount).toBe(12);
    expect(json.stat.flips).toBe(1);
    // claimCount=12 → not low_data; score should be small → stable/healthy.
    expect(['rigid', 'stable', 'healthy']).toContain(json.interpretation);
    // Score is reweighted from raw 0 by falsifiability.ts.
    expect(json.stat.score).toBeGreaterThan(0);
    expect(json.stat.score).toBeLessThanOrEqual(1);
  });

  it('GET /mesh/falsifiability respects custom weights', async () => {
    const r = await fetch(
      `${baseUrl}/mesh/falsifiability?wHighConf=1&wFlips=0&wDelta=0`,
    );
    expect(r.status).toBe(200);
    const json = await r.json();
    expect(json.weights).toEqual({
      highConfidenceRefutations: 1,
      flips: 0,
      posteriorDelta: 0,
    });
  });

  it('GET /mesh/sybil/rank returns a ranked validator list', async () => {
    const r = await fetch(`${baseUrl}/mesh/sybil/rank`);
    expect(r.status).toBe(200);
    const json = await r.json();
    // The mesh-router fixture pool returns [] for validation_observations,
    // so we expect an empty graph and an empty validators list, but the
    // route surface should still be well-formed.
    expect(Array.isArray(json.validators)).toBe(true);
    expect(Array.isArray(json.seeds)).toBe(true);
    expect(typeof json.rounds).toBe('number');
    expect(typeof json.edgeCount).toBe('number');
  });
});
