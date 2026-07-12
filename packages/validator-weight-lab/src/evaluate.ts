/**
 * Evaluation of a candidate validator-weight vector against independent
 * outcomes, with train and holdout separation.
 *
 * The harness does not optimize weights. It evaluates a caller-supplied
 * candidate vector and reports metrics for governance review. There is no
 * built-in optimizer, so there is no invented objective and no invented
 * production default. All bounds and sufficiency minimums are supplied by
 * the caller; nothing is defaulted here.
 */

import { sha256Hex } from './provenance.js';
import {
  WEIGHT_FACTORS,
  type Dataset,
  type LoopEvent,
  type WeightVector,
} from './schema.js';

export interface EvaluationConfig {
  /** The candidate weight vector under evaluation. Required. */
  candidateWeights: WeightVector;
  /** The prior (current) weight vector, if any, for bounded-update checks. */
  priorWeights?: WeightVector;
  /**
   * Maximum permitted absolute change per factor from prior to candidate.
   * Caller-supplied and symbolic. Required when priorWeights is given.
   * No numeric default is invented here.
   */
  maxAbsFactorDelta?: number;
  /**
   * Minimum count of admissible independent-outcome events required before
   * evidence can be called sufficient. Caller-supplied. No default is
   * invented; absence means sufficiency cannot be certified.
   */
  minAdmissibleSamples?: number;
  /**
   * Fraction of loops routed to the holdout split, in (0, 1).
   * Caller-supplied methodology parameter. Required for evaluation.
   */
  holdoutFraction?: number;
}

export type SplitName = 'train' | 'holdout';

export interface SplitMetrics {
  split: SplitName;
  event_count: number;
  admissible_event_count: number;
  burn_rate: number | null;
  reversal_rate: number | null;
  verdict_accuracy: number | null;
  verdict_scored_count: number;
  /**
   * Pearson correlation between the candidate mean selection score and a
   * good-outcome indicator (not burned and not reversed). Null when it
   * cannot be computed, for example zero variance or too few points.
   */
  candidate_alignment: number | null;
}

export interface IntegrityFindings {
  candidate_vector_valid: boolean;
  circular_events: number;
  circularity_detected: boolean;
  bounded_update_checked: boolean;
  bounded_update_ok: boolean;
  per_factor_delta: Partial<Record<keyof WeightVector, number>>;
}

export interface EvaluationResult {
  split_method: string;
  holdout_fraction: number | null;
  train: SplitMetrics;
  holdout: SplitMetrics;
  integrity: IntegrityFindings;
  total_admissible_samples: number;
}

function selectionScore(features: WeightVector, w: WeightVector): number {
  return (
    features.domain * w.domain +
    features.rep * w.rep +
    features.load * w.load +
    features.accuracy * w.accuracy
  );
}

function meanCandidateScore(event: LoopEvent, w: WeightVector): number | null {
  const ids = event.selected_validators;
  if (ids.length === 0) return null;
  let sum = 0;
  let n = 0;
  for (const id of ids) {
    const f = event.selection_features[id];
    if (f) {
      sum += selectionScore(f, w);
      n += 1;
    }
  }
  return n === 0 ? null : sum / n;
}

/** Deterministic split by loop id hash. No randomness, fully reproducible. */
function splitOf(loopId: string, holdoutFraction: number): SplitName {
  const hex = sha256Hex(loopId).slice(0, 8);
  const frac = parseInt(hex, 16) / 0xffffffff;
  return frac < holdoutFraction ? 'holdout' : 'train';
}

function pearson(xs: number[], ys: number[]): number | null {
  const n = xs.length;
  if (n < 2) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  if (sxx === 0 || syy === 0) return null;
  return sxy / Math.sqrt(sxx * syy);
}

function isValidVector(w: WeightVector): boolean {
  return WEIGHT_FACTORS.every((k) => Number.isFinite(w[k]));
}

function computeSplitMetrics(split: SplitName, events: LoopEvent[], w: WeightVector): SplitMetrics {
  const admissible = events.filter((e) => !e.outcome.derived_from_candidate_weights);
  const n = admissible.length;

  let burns = 0;
  let reversals = 0;
  const scores: number[] = [];
  const goodOutcomes: number[] = [];

  let verdictCorrect = 0;
  let verdictScored = 0;

  for (const e of admissible) {
    if (e.outcome.burned) burns += 1;
    if (e.outcome.reversed) reversals += 1;

    const score = meanCandidateScore(e, w);
    const good = !e.outcome.burned && !e.outcome.reversed ? 1 : 0;
    if (score !== null) {
      scores.push(score);
      goodOutcomes.push(good);
    }

    if (e.outcome.verdict_truth && e.verdicts) {
      for (const id of e.selected_validators) {
        const v = e.verdicts[id];
        if (v) {
          verdictScored += 1;
          if (v === e.outcome.verdict_truth) verdictCorrect += 1;
        }
      }
    }
  }

  return {
    split,
    event_count: events.length,
    admissible_event_count: n,
    burn_rate: n === 0 ? null : burns / n,
    reversal_rate: n === 0 ? null : reversals / n,
    verdict_accuracy: verdictScored === 0 ? null : verdictCorrect / verdictScored,
    verdict_scored_count: verdictScored,
    candidate_alignment: pearson(scores, goodOutcomes),
  };
}

function checkBoundedUpdate(cfg: EvaluationConfig): IntegrityFindings['per_factor_delta'] & {
  checked: boolean;
  ok: boolean;
} {
  const perFactor: IntegrityFindings['per_factor_delta'] = {};
  if (!cfg.priorWeights) {
    return { checked: false, ok: true };
  }
  // Prior present but no bound supplied: cannot verify. Report not ok so the
  // recommendation falls back conservatively rather than trusting an
  // unbounded change.
  if (typeof cfg.maxAbsFactorDelta !== 'number' || !Number.isFinite(cfg.maxAbsFactorDelta)) {
    return { checked: false, ok: false };
  }
  let ok = true;
  for (const k of WEIGHT_FACTORS) {
    const delta = Math.abs(cfg.candidateWeights[k] - cfg.priorWeights[k]);
    perFactor[k] = delta;
    if (delta > cfg.maxAbsFactorDelta) ok = false;
  }
  return { ...perFactor, checked: true, ok };
}

export function evaluate(dataset: Dataset, cfg: EvaluationConfig): EvaluationResult {
  const w = cfg.candidateWeights;
  const vectorValid = isValidVector(w);

  const circularEvents = dataset.events.filter(
    (e) => e.outcome.derived_from_candidate_weights,
  ).length;

  const bound = checkBoundedUpdate(cfg);
  const { checked: boundedChecked, ok: boundedOk, ...perFactor } = bound;

  const integrity: IntegrityFindings = {
    candidate_vector_valid: vectorValid,
    circular_events: circularEvents,
    circularity_detected: circularEvents > 0,
    bounded_update_checked: boundedChecked,
    bounded_update_ok: boundedOk,
    per_factor_delta: perFactor,
  };

  const holdoutFraction =
    typeof cfg.holdoutFraction === 'number' &&
    cfg.holdoutFraction > 0 &&
    cfg.holdoutFraction < 1
      ? cfg.holdoutFraction
      : null;

  const trainEvents: LoopEvent[] = [];
  const holdoutEvents: LoopEvent[] = [];
  if (holdoutFraction !== null) {
    for (const e of dataset.events) {
      if (splitOf(e.loop_id, holdoutFraction) === 'holdout') holdoutEvents.push(e);
      else trainEvents.push(e);
    }
  }

  const train = computeSplitMetrics('train', trainEvents, w);
  const holdout = computeSplitMetrics('holdout', holdoutEvents, w);

  return {
    split_method:
      holdoutFraction === null
        ? 'none (holdout fraction not supplied; evaluation not performed)'
        : `deterministic sha256(loop_id) partition, holdout fraction ${holdoutFraction}`,
    holdout_fraction: holdoutFraction,
    train,
    holdout,
    integrity,
    total_admissible_samples: train.admissible_event_count + holdout.admissible_event_count,
  };
}
