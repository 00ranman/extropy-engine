/**
 * ════════════════════════════════════════════════════════════════════════════════
 *  /mesh/* — v3.1 observability routes
 * ════════════════════════════════════════════════════════════════════════════════
 *
 *  Public surface of the redefined epistemology engine. Every endpoint reads
 *  from an EpistemologySource and returns OBSERVATIONS, not authoritative
 *  truth. The mesh decides truth through validation; this surface witnesses.
 *
 *  Endpoints:
 *
 *    GET  /mesh/source                       backend identifier
 *    GET  /mesh/consensus/drift              recent posterior drifts
 *    GET  /mesh/consensus/:claimId           posterior + CI + dissent for one claim
 *    GET  /mesh/falsifiability               domain/window falsifiability score
 *    GET  /mesh/sybil/rank                   random-walk Sybil ranking
 *
 *  Input parsing is minimal and tolerant. Bad query strings degrade to the
 *  default behaviour rather than 400-ing, because dashboards iterate fast
 *  and a flaky query string should not break the page.
 * ════════════════════════════════════════════════════════════════════════════════
 */

import express, { Router, Request, Response } from 'express';
import type {
  EpistemologySource,
  MeshFilter,
  TimeRange,
} from '../../observability/index.js';
import {
  computeFalsifiability,
  DEFAULT_FALSIFIABILITY_WEIGHTS,
  type FalsifiabilityWeights,
} from '../../observability/falsifiability.js';
import {
  getClaimConsensus,
  listConsensusDrift,
} from '../../observability/consensus.js';
import {
  rankValidators,
  toRankedList,
} from '../../observability/sybil.js';
import type { ClaimId, EntropyDomain } from '@extropy/contracts';

export interface MeshRouterDeps {
  source: EpistemologySource;
}

export function createMeshRouter(deps: MeshRouterDeps): Router {
  const router: Router = express.Router();

  // ── Backend introspection ──────────────────────────────────────────────
  router.get('/source', (_req: Request, res: Response) => {
    res.json({ kind: deps.source.kind });
  });

  // ── Consensus drift (must come before /:claimId so the path resolves) ──
  router.get('/consensus/drift', async (req: Request, res: Response) => {
    try {
      const filter = parseMeshFilter(req);
      const minDelta = parseFloatSafe(req.query.minDelta, 0.1);
      const limit = parseIntSafe(req.query.limit, 100);
      const drifts = await listConsensusDrift(deps.source, {
        ...filter,
        minDelta,
        limit,
      });
      res.json({
        filter: { ...filter, minDelta, limit },
        drifts,
        count: drifts.length,
      });
    } catch (err) {
      sendError(res, err);
    }
  });

  // ── Consensus for one claim ────────────────────────────────────────────
  router.get('/consensus/:claimId', async (req: Request, res: Response) => {
    try {
      const claimId = req.params.claimId as ClaimId;
      const snap = await getClaimConsensus(deps.source, claimId);
      if (!snap) {
        res.status(404).json({ error: 'not_found', what: 'claim', claimId });
        return;
      }
      res.json(snap);
    } catch (err) {
      sendError(res, err);
    }
  });

  // ── Falsifiability ─────────────────────────────────────────────────────
  router.get('/falsifiability', async (req: Request, res: Response) => {
    try {
      const filter = parseMeshFilter(req);
      const weights = parseWeights(req);
      const stat = await computeFalsifiability(deps.source, filter, weights);
      res.json({
        filter,
        weights,
        stat,
        interpretation: interpretFalsifiability(stat.score, stat.claimCount),
      });
    } catch (err) {
      sendError(res, err);
    }
  });

  // ── Sybil cluster ranking (random-walk SybilRank-style) ──────────────
  //
  //  Query parameters (all optional):
  //    domain, dfaoId, from, to     standard MeshFilter
  //    seeds                        comma-separated trusted DIDs
  //    rounds                       override iteration count [4..64]
  //    damping                      lazy-walk damping in (0, 1)
  //    fallbackSeedCount            how many top-degree seeds to use
  //                                 when no trusted seeds are supplied
  //    limit                        cap on the response list size
  //
  //  Response shape:
  //    { filter, seeds, rounds, validators: [{ did, score, degree, isSeed }] }
  router.get('/sybil/rank', async (req: Request, res: Response) => {
    try {
      const filter = parseMeshFilter(req);
      const trustedSeeds = parseSeedList(req.query.seeds);
      const rounds = parseIntSafe(req.query.rounds, NaN);
      const damping = parseFloatSafe(req.query.damping, NaN);
      const fallbackSeedCount = parseIntSafe(req.query.fallbackSeedCount, NaN);
      const limit = parseIntSafe(req.query.limit, 1000);

      const result = await rankValidators(deps.source, {
        filter,
        trustedSeeds: trustedSeeds.length > 0 ? trustedSeeds : undefined,
        rounds: Number.isFinite(rounds) ? rounds : undefined,
        damping: Number.isFinite(damping) ? damping : undefined,
        fallbackSeedCount: Number.isFinite(fallbackSeedCount)
          ? fallbackSeedCount
          : undefined,
      });
      const ranked = toRankedList(result, result.edges).slice(0, limit);
      res.json({
        filter,
        seeds: result.seeds,
        rounds: result.rounds,
        edgeCount: result.edges.length,
        validators: ranked,
      });
    } catch (err) {
      sendError(res, err);
    }
  });

  return router;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────────────────────────────────────

function parseMeshFilter(req: Request): MeshFilter {
  const filter: MeshFilter = {};
  const domain = stringQuery(req.query.domain);
  if (domain) filter.domain = domain as EntropyDomain;
  const dfaoId = stringQuery(req.query.dfaoId);
  if (dfaoId) filter.dfaoId = dfaoId;
  const range = parseRange(req);
  if (range.from || range.to) filter.range = range;
  return filter;
}

function parseRange(req: Request): TimeRange {
  const range: TimeRange = {};
  const from = stringQuery(req.query.from);
  const to = stringQuery(req.query.to);
  if (from && isIsoLike(from)) range.from = from;
  if (to && isIsoLike(to)) range.to = to;
  return range;
}

function parseWeights(req: Request): FalsifiabilityWeights {
  const wHigh = parseFloatSafe(req.query.wHighConf, NaN);
  const wFlips = parseFloatSafe(req.query.wFlips, NaN);
  const wDelta = parseFloatSafe(req.query.wDelta, NaN);
  // If any is missing or invalid, fall back to defaults wholesale.
  if (
    !Number.isFinite(wHigh) ||
    !Number.isFinite(wFlips) ||
    !Number.isFinite(wDelta)
  ) {
    return DEFAULT_FALSIFIABILITY_WEIGHTS;
  }
  return {
    highConfidenceRefutations: wHigh,
    flips: wFlips,
    posteriorDelta: wDelta,
  };
}

function interpretFalsifiability(score: number, claimCount: number): string {
  if (claimCount < 10) return 'low_data';
  if (score < 0.05) return 'rigid';
  if (score < 0.15) return 'stable';
  if (score < 0.4) return 'healthy';
  if (score < 0.7) return 'volatile';
  return 'noisy';
}

function stringQuery(v: unknown): string | undefined {
  if (typeof v === 'string' && v.length > 0) return v;
  return undefined;
}

function parseIntSafe(v: unknown, fallback: number): number {
  if (typeof v !== 'string') return fallback;
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function parseFloatSafe(v: unknown, fallback: number): number {
  if (typeof v !== 'string') return fallback;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}

function parseSeedList(v: unknown): string[] {
  if (typeof v !== 'string' || v.length === 0) return [];
  return v
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function isIsoLike(s: string): boolean {
  // Permissive: accept anything Date.parse can read, reject NaN.
  return !Number.isNaN(Date.parse(s));
}

function sendError(res: Response, err: unknown): void {
  // eslint-disable-next-line no-console
  console.error('[epistemology-engine /mesh] error:', err);
  const msg = err instanceof Error ? err.message : String(err);
  // 502 because the failure is downstream (Postgres, DAG node).
  res.status(502).json({ error: 'source_error', reason: msg });
}
