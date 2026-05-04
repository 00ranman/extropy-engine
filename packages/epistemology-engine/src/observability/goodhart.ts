/**
 * ════════════════════════════════════════════════════════════════════════════════
 *  observability/goodhart.ts — Goodhart-pattern signal surface
 * ════════════════════════════════════════════════════════════════════════════════
 *
 *  "When a measure becomes a target, it ceases to be a good measure."
 *
 *  In the Extropy Engine, XP is the measure. The risk is that validators
 *  optimize for XP-emitting validation patterns rather than for truth. The
 *  Goodhart surface compares XP accumulation against INDEPENDENTLY observed
 *  outcomes (downstream claim-flip rates, governance challenges that
 *  succeeded against the validator's earlier stance, etc.) and flags
 *  validators whose XP velocity decouples from their accuracy.
 *
 *  v3.1: scaffold. Body lands once we have at least one independent outcome
 *  series to correlate against (likely v3.2).
 * ════════════════════════════════════════════════════════════════════════════════
 */

import type { EpistemologySource, MeshFilter } from './source.js';

export interface GoodhartSignal {
  validatorDid: string;
  /** XP earned in the window. */
  xpEarned: number;
  /** Validator's accuracy on resolved claims in the same window. */
  accuracy: number;
  /** Pearson correlation between this validator's confidences and resolved truth, in [-1, 1]. */
  truthCorrelation: number;
  /** Suspicion score in [0, 1]. High = XP velocity is decoupled from accuracy. */
  suspicion: number;
}

export async function detectGoodhartSignals(
  _source: EpistemologySource,
  _filter: MeshFilter,
): Promise<GoodhartSignal[]> {
  return [];
}
