/**
 *  Tests for commit 3: random-walk Sybil ranking.
 *
 *  These tests cover:
 *
 *    1. PostgresSource Sybil read methods (listValidationObservations,
 *       listValidatorCoEdges, listValidatorDids) bind params correctly.
 *    2. rankValidators algorithm:
 *       - empty graph returns empty result
 *       - seeds are honoured when provided
 *       - top-degree fallback selects seeds deterministically
 *       - trusted DIDs strongly connected to seeds rank above isolated
 *         clusters with high internal degree but no seed connection
 *       - identical inputs produce identical outputs (determinism)
 *    3. /mesh/sybil/rank route honours query parameters and returns the
 *       ranked validator list.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import express, { type Express } from 'express';
import { PostgresSource } from '../observability/index.js';
import {
  rankValidators,
  toRankedList,
  type SybilRankResult,
} from '../observability/sybil.js';
import { createMeshRouter } from '../routes/mesh/index.js';
import type {
  EpistemologySource,
  MeshFilter,
  ValidatorCoEdge,
} from '../observability/index.js';

// ─────────────────────────────────────────────────────────────────────────────
//  Fake pool helper (same shape as observability.test.ts; copied here so the
//  two suites stay independent when one is run in isolation).
// ─────────────────────────────────────────────────────────────────────────────

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
//  In-memory EpistemologySource for algorithm tests.
//  Returns whatever DIDs and edges the test sets up; everything else stubs.
// ─────────────────────────────────────────────────────────────────────────────

class InMemorySource implements EpistemologySource {
  readonly kind = 'postgres' as const;
  constructor(
    private readonly dids: string[],
    private readonly edges: ValidatorCoEdge[],
  ) {}
  async init(): Promise<void> {}
  async close(): Promise<void> {}
  async listValidationObservations(): Promise<never[]> {
    return [];
  }
  async getClaimConsensus(): Promise<null> {
    return null;
  }
  async listConsensusDrift(): Promise<never[]> {
    return [];
  }
  async computeFalsifiability(filter: MeshFilter) {
    return {
      domain: (filter.domain ?? 'COGNITIVE') as never,
      dfaoId: filter.dfaoId,
      range: filter.range ?? {},
      claimCount: 0,
      flips: 0,
      posteriorDelta: 0,
      highConfidenceRefutations: 0,
      score: 0,
    };
  }
  async listValidatorCoEdges(): Promise<ValidatorCoEdge[]> {
    return this.edges;
  }
  async listValidatorDids(): Promise<string[]> {
    return this.dids;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  PostgresSource Sybil reads
// ─────────────────────────────────────────────────────────────────────────────

describe('PostgresSource Sybil reads', () => {
  it('listValidatorDids returns distinct DIDs filtered by domain + range', async () => {
    const { pool, calls } = makeFakePool([
      {
        match: 'FROM validation_observations',
        rows: [{ validator_did: 'did:extropy:alice' }, { validator_did: 'did:extropy:bob' }],
      },
    ]);
    const s = new PostgresSource({ pool });
    await s.init();
    const dids = await s.listValidatorDids({
      domain: 'COGNITIVE' as never,
      range: { from: '2026-01-01T00:00:00Z' },
    });
    expect(dids).toEqual(['did:extropy:alice', 'did:extropy:bob']);
    const call = calls.find((c) => c.sql.includes('SELECT DISTINCT validator_did'))!;
    expect(call.params).toEqual(['COGNITIVE', '2026-01-01T00:00:00Z']);
    expect(call.sql).toContain('domain = $1');
    expect(call.sql).toContain('observed_at >= $2');
  });

  it('listValidatorCoEdges runs a self-join with minWeight + limit at the end of params', async () => {
    const { pool, calls } = makeFakePool([
      {
        match: 'FROM validation_observations a',
        rows: [
          {
            from_did: 'did:extropy:alice',
            to_did: 'did:extropy:bob',
            weight: 4,
            last_observed_at: new Date('2026-04-01T00:00:00Z'),
          },
        ],
      },
    ]);
    const s = new PostgresSource({ pool });
    await s.init();
    const edges = await s.listValidatorCoEdges({
      domain: 'COGNITIVE' as never,
      minWeight: 2,
      limit: 100,
    });
    expect(edges).toEqual([
      {
        fromDid: 'did:extropy:alice',
        toDid: 'did:extropy:bob',
        weight: 4,
        lastObservedAt: '2026-04-01T00:00:00.000Z',
      },
    ]);
    const call = calls.find((c) => c.sql.includes('FROM validation_observations a'))!;
    // Domain pushes twice (a.domain, b.domain), then minWeight, then limit.
    expect(call.params).toEqual(['COGNITIVE', 'COGNITIVE', 2, 100]);
    expect(call.sql).toContain('a.validator_did < b.validator_did');
    expect(call.sql).toContain('HAVING COUNT(DISTINCT a.sub_claim_id) >= $3');
  });

  it('listValidationObservations honours all filters and a limit', async () => {
    const { pool, calls } = makeFakePool([
      {
        match: 'FROM validation_observations',
        rows: [
          {
            sub_claim_id: 'sc-1',
            claim_id: 'c-1',
            validator_did: 'did:extropy:alice',
            domain: 'COGNITIVE',
            evidence_confidence: 0.8,
            counter_confidence: null,
            dag_receipt_digest: null,
            observed_at: new Date('2026-03-01T00:00:00Z'),
          },
        ],
      },
    ]);
    const s = new PostgresSource({ pool });
    await s.init();
    const obs = await s.listValidationObservations({
      claimId: 'c-1' as never,
      validatorDid: 'did:extropy:alice',
      limit: 50,
    });
    expect(obs).toHaveLength(1);
    expect(obs[0].subClaimId).toBe('sc-1');
    expect(obs[0].evidenceConfidence).toBe(0.8);
    expect(obs[0].counterConfidence).toBeUndefined();
    const call = calls.find((c) => c.sql.includes('FROM validation_observations'))!;
    // Order: claim_id, validator_did, limit.
    expect(call.params).toEqual(['c-1', 'did:extropy:alice', 50]);
    expect(call.sql).toContain('claim_id = $1');
    expect(call.sql).toContain('validator_did = $2');
    expect(call.sql).toMatch(/LIMIT \$3/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
//  rankValidators algorithm
// ─────────────────────────────────────────────────────────────────────────────

describe('rankValidators', () => {
  it('returns empty result for an empty graph', async () => {
    const src = new InMemorySource([], []);
    const r = await rankValidators(src, { filter: {} });
    expect(r.scores.size).toBe(0);
    expect(r.edges).toEqual([]);
    expect(r.rounds).toBe(0);
  });

  it('honours trusted seeds and rejects DIDs not in the vertex set', async () => {
    const dids = ['a', 'b', 'c'];
    const edges: ValidatorCoEdge[] = [
      { fromDid: 'a', toDid: 'b', weight: 1, lastObservedAt: '2026-01-01T00:00:00Z' },
      { fromDid: 'b', toDid: 'c', weight: 1, lastObservedAt: '2026-01-02T00:00:00Z' },
    ];
    const src = new InMemorySource(dids, edges);
    const r = await rankValidators(src, {
      filter: {},
      trustedSeeds: ['a', 'ghost-not-in-graph'],
    });
    // 'ghost-not-in-graph' is dropped because it is not a vertex.
    expect(r.seeds).toEqual(['a']);
    // Score for 'a' should be defined and non-zero (it is the seed).
    const scoreA = r.scores.get('a') ?? 0;
    expect(scoreA).toBeGreaterThan(0);
  });

  it('falls back to top-N by weighted degree when no trusted seeds are supplied', async () => {
    const dids = ['hub', 'leaf-1', 'leaf-2', 'island'];
    const edges: ValidatorCoEdge[] = [
      { fromDid: 'hub', toDid: 'leaf-1', weight: 5, lastObservedAt: '2026-01-01T00:00:00Z' },
      { fromDid: 'hub', toDid: 'leaf-2', weight: 3, lastObservedAt: '2026-01-02T00:00:00Z' },
      // 'island' has no edges.
    ];
    const src = new InMemorySource(dids, edges);
    const r = await rankValidators(src, {
      filter: {},
      fallbackSeedCount: 1,
    });
    expect(r.seeds).toEqual(['hub']);
  });

  it('ranks seed-connected validators above isolated Sybil clusters', async () => {
    // Setup:
    //   trusted, t-friend     <- the trusted island (seed = trusted)
    //   sybil-1 ... sybil-4   <- Sybil cluster, fully internally connected,
    //                           but ZERO edges to the trusted island.
    const dids = [
      'trusted',
      't-friend',
      'sybil-1',
      'sybil-2',
      'sybil-3',
      'sybil-4',
    ];
    const edges: ValidatorCoEdge[] = [
      // Trusted island.
      { fromDid: 'trusted', toDid: 't-friend', weight: 5, lastObservedAt: '2026-01-01T00:00:00Z' },
      // Sybil clique.
      { fromDid: 'sybil-1', toDid: 'sybil-2', weight: 9, lastObservedAt: '2026-01-02T00:00:00Z' },
      { fromDid: 'sybil-1', toDid: 'sybil-3', weight: 9, lastObservedAt: '2026-01-02T00:00:00Z' },
      { fromDid: 'sybil-1', toDid: 'sybil-4', weight: 9, lastObservedAt: '2026-01-02T00:00:00Z' },
      { fromDid: 'sybil-2', toDid: 'sybil-3', weight: 9, lastObservedAt: '2026-01-02T00:00:00Z' },
      { fromDid: 'sybil-2', toDid: 'sybil-4', weight: 9, lastObservedAt: '2026-01-02T00:00:00Z' },
      { fromDid: 'sybil-3', toDid: 'sybil-4', weight: 9, lastObservedAt: '2026-01-02T00:00:00Z' },
    ];
    const src = new InMemorySource(dids, edges);
    const r = await rankValidators(src, {
      filter: {},
      trustedSeeds: ['trusted'],
    });
    const trusted = r.scores.get('trusted') ?? 0;
    const tFriend = r.scores.get('t-friend') ?? 0;
    const sybil1 = r.scores.get('sybil-1') ?? 0;
    const sybil4 = r.scores.get('sybil-4') ?? 0;
    // Trusted island gets ALL the mass; the Sybil cluster has no path
    // back to the seed and therefore must rank below the trusted nodes.
    expect(trusted).toBeGreaterThan(sybil1);
    expect(tFriend).toBeGreaterThan(sybil1);
    expect(trusted).toBeGreaterThan(sybil4);
    // The Sybil cluster collapses to zero (no seed mass reaches it).
    expect(sybil1).toBe(0);
    expect(sybil4).toBe(0);
  });

  it('is deterministic across runs with identical inputs', async () => {
    const dids = ['a', 'b', 'c', 'd'];
    const edges: ValidatorCoEdge[] = [
      { fromDid: 'a', toDid: 'b', weight: 2, lastObservedAt: '2026-01-01T00:00:00Z' },
      { fromDid: 'a', toDid: 'c', weight: 1, lastObservedAt: '2026-01-01T00:00:00Z' },
      { fromDid: 'b', toDid: 'd', weight: 3, lastObservedAt: '2026-01-01T00:00:00Z' },
    ];
    const src = new InMemorySource(dids, edges);
    const r1 = await rankValidators(src, { filter: {}, trustedSeeds: ['a'] });
    const r2 = await rankValidators(src, { filter: {}, trustedSeeds: ['a'] });
    expect(Array.from(r1.scores.entries())).toEqual(Array.from(r2.scores.entries()));
    expect(r1.rounds).toBe(r2.rounds);
    expect(r1.seeds).toEqual(r2.seeds);
  });

  it('clamps damping into (0, 1) and rounds into [4, 64]', async () => {
    const src = new InMemorySource(
      ['a', 'b'],
      [{ fromDid: 'a', toDid: 'b', weight: 1, lastObservedAt: '2026-01-01T00:00:00Z' }],
    );
    const r = await rankValidators(src, {
      filter: {},
      trustedSeeds: ['a'],
      damping: 5, // invalid, will be clamped to 0.99
      rounds: 1000, // will be clamped to 64
    });
    expect(r.rounds).toBe(64);
    // Both nodes should have non-negative scores.
    for (const [, v] of r.scores) expect(v).toBeGreaterThanOrEqual(0);
  });

  it('toRankedList sorts by score desc with deterministic DID tie-break', async () => {
    const dids = ['a', 'b', 'c'];
    const edges: ValidatorCoEdge[] = [
      { fromDid: 'a', toDid: 'b', weight: 1, lastObservedAt: '2026-01-01T00:00:00Z' },
    ];
    const src = new InMemorySource(dids, edges);
    const r: SybilRankResult = await rankValidators(src, {
      filter: {},
      trustedSeeds: ['a'],
    });
    const ranked = toRankedList(r, edges);
    // 'a' is the seed and only seed-mass holder; should top the list.
    expect(ranked[0].did).toBe('a');
    expect(ranked[0].isSeed).toBe(true);
    // 'c' has no edges, degree 0, score 0.
    const c = ranked.find((x) => x.did === 'c')!;
    expect(c.degree).toBe(0);
    expect(c.score).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
//  /mesh/sybil/rank route, exercised against an InMemorySource
// ─────────────────────────────────────────────────────────────────────────────

describe('/mesh/sybil/rank route', () => {
  let app: Express;
  let baseUrl: string;
  let server: ReturnType<Express['listen']>;

  beforeAll(async () => {
    const dids = ['trusted', 'friend', 'sybil-a', 'sybil-b'];
    const edges: ValidatorCoEdge[] = [
      { fromDid: 'trusted', toDid: 'friend', weight: 4, lastObservedAt: '2026-04-01T00:00:00Z' },
      { fromDid: 'sybil-a', toDid: 'sybil-b', weight: 7, lastObservedAt: '2026-04-02T00:00:00Z' },
    ];
    const source = new InMemorySource(dids, edges);
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

  it('returns a ranked validator list and trusted seeds rank above the Sybil island', async () => {
    const r = await fetch(`${baseUrl}/mesh/sybil/rank?seeds=trusted`);
    expect(r.status).toBe(200);
    const json = await r.json();
    expect(json.seeds).toEqual(['trusted']);
    expect(json.edgeCount).toBe(2);
    expect(Array.isArray(json.validators)).toBe(true);
    // The first entry should be a seed-connected DID, not a Sybil DID.
    const top = json.validators[0];
    expect(['trusted', 'friend']).toContain(top.did);
    // Sybil-a / sybil-b should both be 0 because no seed mass reaches them.
    const sybilEntries = json.validators.filter(
      (v: { did: string }) => v.did === 'sybil-a' || v.did === 'sybil-b',
    );
    for (const s of sybilEntries) expect(s.score).toBe(0);
  });

  it('honours rounds, damping, fallbackSeedCount, and limit query params', async () => {
    const r = await fetch(
      `${baseUrl}/mesh/sybil/rank?rounds=8&damping=0.5&fallbackSeedCount=2&limit=2`,
    );
    expect(r.status).toBe(200);
    const json = await r.json();
    expect(json.rounds).toBe(8);
    expect(json.validators.length).toBeLessThanOrEqual(2);
  });

  it('falls back to top-degree seeds when seeds are not supplied', async () => {
    const r = await fetch(`${baseUrl}/mesh/sybil/rank?fallbackSeedCount=1`);
    expect(r.status).toBe(200);
    const json = await r.json();
    // 'sybil-a' and 'sybil-b' have degree 7 each, 'trusted' and 'friend' 4.
    // Tie-break is by DID string ascending, so 'sybil-a' wins.
    expect(json.seeds).toEqual(['sybil-a']);
  });
});
