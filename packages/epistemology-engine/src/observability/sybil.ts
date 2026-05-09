/**
 * ════════════════════════════════════════════════════════════════════════════════
 *  observability/sybil.ts: Random-walk Sybil ranking (sandbox-grade)
 * ════════════════════════════════════════════════════════════════════════════════
 *
 *  SybilRank-style power iteration over the validator co-validation graph:
 *
 *    1. Build the validator co-validation graph from the EpistemologySource
 *       (vertices = DIDs, edges = co-validation events weighted by frequency).
 *    2. Seed the walk on a small set of TRUSTED DIDs (governance-curated;
 *       falls back to top-N by weighted degree in the sandbox).
 *    3. Run a power iteration of the lazy random walk for O(log n) rounds.
 *       Each round: every node propagates its trust mass to neighbours
 *       proportional to edge weights, with a damping factor that returns
 *       (1 - damping) of mass to the seed set on every step.
 *    4. Rank DIDs by trust mass per (degree + 1). Suspect Sybil clusters
 *       surface at the bottom of the ranking because they typically have
 *       high internal degree but low connection back to the trusted seed.
 *
 *  This is NOT cryptographically resistant Sybil defense. It is a SIGNAL
 *  surface. Governance and reputation packages consume the ranking, they
 *  do not act on it autonomously. The hard Sybil resistance comes from the
 *  identity package (KYC + DID + per-context nullifiers).
 *
 *  Determinism: identical inputs produce identical outputs. Iteration order
 *  is over a sorted DID list; ties in seed-fallback selection break by DID
 *  string ordering. This matters for testability and for letting governance
 *  audit a ranking on demand.
 *
 *  Convergence: lazy random walks on a connected weighted graph converge
 *  in O(log n) rounds for SybilRank-style guarantees. We default to
 *  ⌈log2(max(n, 2))⌉ + 2, with a hard floor of 4 and ceiling of 64 rounds.
 * ════════════════════════════════════════════════════════════════════════════════
 */

import type {
  EpistemologySource,
  ValidatorCoEdge,
  MeshFilter,
} from './source.js';

export interface SybilRankResult {
  /** DID → trust score in [0, 1]. */
  scores: Map<string, number>;
  /** Edges used in the computation, for transparency. */
  edges: ValidatorCoEdge[];
  /** Trusted seed set the walk started from. */
  seeds: string[];
  /** Number of power-iteration rounds run. */
  rounds: number;
}

export interface SybilRankOptions {
  filter: MeshFilter;
  /** Trusted seed DIDs. Walks start here. */
  trustedSeeds?: string[];
  /** Override iteration count. Default = ⌈log2(n)⌉ + 2, clamped to [4, 64]. */
  rounds?: number;
  /** Lazy walk parameter, in (0, 1). Default 0.85, mirroring PageRank's damping. */
  damping?: number;
  /** When trustedSeeds is empty, pick this many top-degree DIDs as seeds. */
  fallbackSeedCount?: number;
}

const DEFAULT_DAMPING = 0.85;
const DEFAULT_FALLBACK_SEED_COUNT = 5;
const MIN_ROUNDS = 4;
const MAX_ROUNDS = 64;

export async function rankValidators(
  source: EpistemologySource,
  opts: SybilRankOptions,
): Promise<SybilRankResult> {
  const dids = (await source.listValidatorDids(opts.filter)).slice().sort();
  const edges = await source.listValidatorCoEdges(opts.filter);

  // Empty graph → return zeros and the requested seed set verbatim.
  if (dids.length === 0) {
    return {
      scores: new Map(),
      edges: [],
      seeds: opts.trustedSeeds ?? [],
      rounds: 0,
    };
  }

  const damping = clampOpenUnit(opts.damping ?? DEFAULT_DAMPING);
  const fallbackSeedCount = Math.max(
    1,
    opts.fallbackSeedCount ?? DEFAULT_FALLBACK_SEED_COUNT,
  );

  // Adjacency: for each DID, the list of {neighbourDid, weight} pairs.
  // Edges are undirected, so each ValidatorCoEdge (a, b) inserts into both
  // a's and b's adjacency lists. weightedDegree caches the row sum.
  const adjacency = new Map<string, Array<{ to: string; weight: number }>>();
  const weightedDegree = new Map<string, number>();
  for (const did of dids) {
    adjacency.set(did, []);
    weightedDegree.set(did, 0);
  }
  for (const e of edges) {
    if (!adjacency.has(e.fromDid) || !adjacency.has(e.toDid)) continue;
    adjacency.get(e.fromDid)!.push({ to: e.toDid, weight: e.weight });
    adjacency.get(e.toDid)!.push({ to: e.fromDid, weight: e.weight });
    weightedDegree.set(
      e.fromDid,
      (weightedDegree.get(e.fromDid) ?? 0) + e.weight,
    );
    weightedDegree.set(
      e.toDid,
      (weightedDegree.get(e.toDid) ?? 0) + e.weight,
    );
  }

  // Resolve seeds: governance-supplied if present, else top-N by weighted
  // degree (deterministic by DID string order on ties). Restrict to DIDs
  // actually present in the vertex set so a stale governance config does
  // not zero the walk out.
  const didSet = new Set(dids);
  const filteredTrusted = (opts.trustedSeeds ?? []).filter((d) => didSet.has(d));
  const seeds =
    filteredTrusted.length > 0
      ? filteredTrusted.slice().sort()
      : pickTopByDegree(dids, weightedDegree, fallbackSeedCount);

  // Initial trust vector: 1 / |seeds| on each seed, 0 elsewhere.
  const trust = new Map<string, number>();
  for (const did of dids) trust.set(did, 0);
  if (seeds.length > 0) {
    const seedShare = 1 / seeds.length;
    for (const s of seeds) trust.set(s, seedShare);
  }

  // Determine round count.
  const defaultRounds = Math.ceil(Math.log2(Math.max(dids.length, 2))) + 2;
  const rounds = clampInt(opts.rounds ?? defaultRounds, MIN_ROUNDS, MAX_ROUNDS);

  // Power iteration. Each step:
  //   t_next[v] = (1 - d) * seed_prior[v]
  //             +       d * Σ_{u ~ v} (w(u,v) / weightedDegree[u]) * t[u]
  // The damping mass returns to the seed set, which is the standard
  // teleportation trick that makes the walk converge to a unique stationary
  // distribution biased toward the seeds.
  const seedPrior = new Map<string, number>();
  for (const did of dids) seedPrior.set(did, 0);
  const seedShare = seeds.length > 0 ? 1 / seeds.length : 0;
  for (const s of seeds) seedPrior.set(s, seedShare);

  let current = trust;
  for (let round = 0; round < rounds; round++) {
    const next = new Map<string, number>();
    for (const did of dids) next.set(did, (1 - damping) * (seedPrior.get(did) ?? 0));
    for (const u of dids) {
      const uMass = current.get(u) ?? 0;
      if (uMass === 0) continue;
      const uDeg = weightedDegree.get(u) ?? 0;
      if (uDeg === 0) {
        // Dangling node: redistribute mass to seeds (standard PageRank trick).
        for (const s of seeds) {
          next.set(s, (next.get(s) ?? 0) + damping * uMass * (1 / seeds.length));
        }
        continue;
      }
      for (const { to, weight } of adjacency.get(u) ?? []) {
        next.set(to, (next.get(to) ?? 0) + damping * uMass * (weight / uDeg));
      }
    }
    current = next;
  }

  // Normalize trust per (weighted degree + 1) so that high-degree nodes do
  // not automatically dominate. This is the SybilRank "trust per degree"
  // step; suspect clusters with high internal degree but weak seed
  // connectivity drop to the bottom.
  const normalized = new Map<string, number>();
  let maxNormalized = 0;
  for (const did of dids) {
    const t = current.get(did) ?? 0;
    const deg = weightedDegree.get(did) ?? 0;
    const v = t / (deg + 1);
    normalized.set(did, v);
    if (v > maxNormalized) maxNormalized = v;
  }
  // Rescale to [0, 1] so consumers get a comparable surface.
  const scores = new Map<string, number>();
  if (maxNormalized > 0) {
    for (const [did, v] of normalized) scores.set(did, v / maxNormalized);
  } else {
    for (const did of dids) scores.set(did, 0);
  }

  return { scores, edges, seeds, rounds };
}

// ─────────────────────────────────────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────────────────────────────────────

function pickTopByDegree(
  dids: string[],
  weightedDegree: Map<string, number>,
  count: number,
): string[] {
  const ranked = dids
    .slice()
    .sort((a, b) => {
      const da = weightedDegree.get(a) ?? 0;
      const db = weightedDegree.get(b) ?? 0;
      if (db !== da) return db - da;
      return a < b ? -1 : a > b ? 1 : 0;
    });
  return ranked.slice(0, Math.min(count, ranked.length));
}

function clampOpenUnit(x: number): number {
  if (!Number.isFinite(x)) return DEFAULT_DAMPING;
  if (x <= 0) return 0.01;
  if (x >= 1) return 0.99;
  return x;
}

function clampInt(x: number, lo: number, hi: number): number {
  if (!Number.isFinite(x)) return lo;
  const n = Math.floor(x);
  if (n < lo) return lo;
  if (n > hi) return hi;
  return n;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Convenience: ranked list with metadata for the /mesh/sybil/rank route
// ─────────────────────────────────────────────────────────────────────────────

export interface RankedValidator {
  did: string;
  score: number;
  /** Weighted degree in the co-validation graph. */
  degree: number;
  /** Whether this DID was in the seed set. */
  isSeed: boolean;
}

export function toRankedList(
  result: SybilRankResult,
  edges: ValidatorCoEdge[],
): RankedValidator[] {
  const seedSet = new Set(result.seeds);
  const degrees = new Map<string, number>();
  for (const e of edges) {
    degrees.set(e.fromDid, (degrees.get(e.fromDid) ?? 0) + e.weight);
    degrees.set(e.toDid, (degrees.get(e.toDid) ?? 0) + e.weight);
  }
  const ranked: RankedValidator[] = [];
  for (const [did, score] of result.scores) {
    ranked.push({
      did,
      score,
      degree: degrees.get(did) ?? 0,
      isSeed: seedSet.has(did),
    });
  }
  ranked.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.did < b.did ? -1 : a.did > b.did ? 1 : 0;
  });
  return ranked;
}
