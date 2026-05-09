/**
 * ════════════════════════════════════════════════════════════════════════════════
 *  observability/falsifiability.ts
 * ════════════════════════════════════════════════════════════════════════════════
 *
 *  Falsifiability is a HEALTH metric. A mesh that never overturns confident
 *  claims may be capturing validators or breeding conformity. A mesh that
 *  flips constantly may be noisy. The score below balances both.
 *
 *  Provisional formulation (v3.1, refined in commit 2):
 *
 *    score = w_h * (highConfidenceRefutations / max(claimCount, 1))
 *          + w_f * (flips / max(claimCount, 1))
 *          + w_d * mean(|posteriorDelta|)
 *          ; weights w_h + w_f + w_d = 1, default {0.5, 0.3, 0.2}
 *
 *  Bounded to [0, 1]. The component computations live in the source layer;
 *  this file is the assembly + interpretation surface.
 * ════════════════════════════════════════════════════════════════════════════════
 */

import type {
  EpistemologySource,
  FalsifiabilityStat,
  MeshFilter,
} from './source.js';

export interface FalsifiabilityWeights {
  highConfidenceRefutations: number;
  flips: number;
  posteriorDelta: number;
}

export const DEFAULT_FALSIFIABILITY_WEIGHTS: FalsifiabilityWeights = {
  highConfidenceRefutations: 0.5,
  flips: 0.3,
  posteriorDelta: 0.2,
};

export async function computeFalsifiability(
  source: EpistemologySource,
  filter: MeshFilter,
  weights: FalsifiabilityWeights = DEFAULT_FALSIFIABILITY_WEIGHTS,
): Promise<FalsifiabilityStat> {
  const stat = await source.computeFalsifiability(filter);
  // The source returns raw counts and a placeholder score. Recompute the
  // assembled score here so the weighting policy is owned by this module
  // (and not by every backend implementer).
  const claims = Math.max(stat.claimCount, 1);
  const assembled =
    weights.highConfidenceRefutations * (stat.highConfidenceRefutations / claims) +
    weights.flips * (stat.flips / claims) +
    weights.posteriorDelta * Math.min(Math.abs(stat.posteriorDelta), 1);
  return { ...stat, score: clamp01(assembled) };
}

function clamp01(x: number): number {
  if (Number.isNaN(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}
