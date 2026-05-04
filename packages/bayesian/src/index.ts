/**
 * ════════════════════════════════════════════════════════════════════════════════
 *  Bayesian Math — Beta(α, β) conjugate posterior for binary claims
 * ════════════════════════════════════════════════════════════════════════════════
 *
 *  v3.1 redefinition. Replaces the v3.0 point-estimate Bayes (which advertised
 *  itself as Beta but was just a single-step likelihood ratio update) with the
 *  proper conjugate prior:
 *
 *    Prior:     θ ~ Beta(α, β)
 *    Likelihood: each piece of evidence is a Bernoulli(θ) trial
 *    Posterior: θ | data ~ Beta(α + Σ confirming, β + Σ disconfirming)
 *
 *  Posterior mean = α / (α + β)
 *  Credible interval = [Beta_quantile(0.025; α, β), Beta_quantile(0.975; α, β)]
 *
 *  Defaults to Jeffreys prior Beta(½, ½), the standard reference prior for a
 *  Bernoulli rate. Strength of an informative prior is calibrated by the total
 *  pseudo-count α₀ + β₀.
 *
 *  Aggregation across sub-claims uses weighted log-odds. Posterior mean is
 *  converted to logit, weighted, summed, and converted back. This is the
 *  principled fusion of independent probabilistic judgements (mathematically
 *  equivalent to a weighted geometric mean of likelihood ratios) and avoids
 *  the multiplicative collapse-to-zero pathology of plain ∏ pᵢ^wᵢ.
 *
 *  No external numeric libraries. Continued-fraction expansion of the
 *  regularized incomplete beta function I_x(a, b) per Numerical Recipes,
 *  inverted by safe-guarded bisection for quantiles.
 *
 * ════════════════════════════════════════════════════════════════════════════════
 */

import type { BayesianPrior, BayesianUpdate, MeasurementId, SubClaimId } from '@extropy/contracts';

// ─────────────────────────────────────────────────────────────────────────────
//  Numerical kernel: log-Gamma, log-Beta, regularized incomplete beta
// ─────────────────────────────────────────────────────────────────────────────

/** Lanczos approximation for ln Γ(z), z > 0. Accurate to ~1e-14 over its domain. */
function lnGamma(z: number): number {
  const g = 7;
  const c = [
    0.99999999999980993,
    676.5203681218851,
    -1259.1392167224028,
    771.32342877765313,
    -176.61502916214059,
    12.507343278686905,
    -0.13857109526572012,
    9.9843695780195716e-6,
    1.5056327351493116e-7,
  ];
  if (z < 0.5) {
    // Reflection: Γ(z)Γ(1−z) = π / sin(πz)
    return Math.log(Math.PI / Math.sin(Math.PI * z)) - lnGamma(1 - z);
  }
  z -= 1;
  let x = c[0]!;
  for (let i = 1; i < g + 2; i++) x += c[i]! / (z + i);
  const t = z + g + 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}

/** ln B(a, b) = ln Γ(a) + ln Γ(b) − ln Γ(a+b). */
function lnBeta(a: number, b: number): number {
  return lnGamma(a) + lnGamma(b) - lnGamma(a + b);
}

/**
 * Continued-fraction evaluation for the regularized incomplete beta I_x(a, b)
 * per Numerical Recipes §6.4. Converges quadratically in the canonical region.
 */
function betaContinuedFraction(x: number, a: number, b: number): number {
  const MAX_ITER = 200;
  const EPS = 3e-16;
  const FPMIN = 1e-300;

  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= MAX_ITER; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) return h;
  }
  return h; // best effort
}

/** Regularized incomplete beta function I_x(a, b) ∈ [0,1]; equals P(X ≤ x) for X ~ Beta(a,b). */
export function betaCdf(x: number, a: number, b: number): number {
  if (a <= 0 || b <= 0) throw new Error('betaCdf: a and b must be > 0');
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const front = Math.exp(-lnBeta(a, b) + a * Math.log(x) + b * Math.log(1 - x));
  // Use the continued fraction in whichever region converges faster.
  if (x < (a + 1) / (a + b + 2)) {
    return (front * betaContinuedFraction(x, a, b)) / a;
  } else {
    return 1 - (front * betaContinuedFraction(1 - x, b, a)) / b;
  }
}

/**
 * Inverse CDF of Beta(a, b): returns x such that betaCdf(x, a, b) ≈ p.
 * Bisection on [0, 1] with 60 iterations → ~1e-18 precision (machine epsilon).
 */
export function betaQuantile(p: number, a: number, b: number): number {
  if (a <= 0 || b <= 0) throw new Error('betaQuantile: a and b must be > 0');
  if (p <= 0) return 0;
  if (p >= 1) return 1;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (betaCdf(mid, a, b) < p) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** 95% credible interval of Beta(a, b). */
export function betaCI95(a: number, b: number): [number, number] {
  return [betaQuantile(0.025, a, b), betaQuantile(0.975, a, b)];
}

// ─────────────────────────────────────────────────────────────────────────────
//  Prior construction & updates
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Strength of an informative prior, expressed as total pseudo-count α + β.
 * Default 2 = Jeffreys prior strength scaled by mean (yields Beta(1, 1) at p=0.5).
 * Higher = more confident prior, harder to budge with new evidence.
 */
export const DEFAULT_PRIOR_STRENGTH = 2;

/** Jeffreys reference prior Beta(½, ½) — the standard noninformative choice. */
export const JEFFREYS_PRIOR: { alpha: number; beta: number } = { alpha: 0.5, beta: 0.5 };

/**
 * Construct a v3.1 BayesianPrior from a prior probability + strength.
 *
 *   meanProbability = priorProbability  (the only thing the caller has to know)
 *   α = meanProbability × strength
 *   β = (1 − meanProbability) × strength
 *
 * If priorProbability is omitted → Jeffreys Beta(½, ½).
 */
export function initBayesianPrior(
  priorProbability?: number,
  strength: number = DEFAULT_PRIOR_STRENGTH,
): BayesianPrior {
  let alpha: number;
  let beta: number;

  if (priorProbability === undefined) {
    alpha = JEFFREYS_PRIOR.alpha;
    beta = JEFFREYS_PRIOR.beta;
  } else {
    if (priorProbability <= 0 || priorProbability >= 1) {
      throw new Error(`initBayesianPrior: priorProbability must be in (0,1), got ${priorProbability}`);
    }
    if (strength <= 0) {
      throw new Error(`initBayesianPrior: strength must be > 0, got ${strength}`);
    }
    alpha = priorProbability * strength;
    beta = (1 - priorProbability) * strength;
  }

  const mean = alpha / (alpha + beta);
  const ci = betaCI95(alpha, beta);

  return {
    alpha,
    beta,
    priorProbability: mean,
    likelihood: 0.5, // legacy fields, no longer drive math; populated for compat
    counterLikelihood: 0.5,
    posteriorProbability: mean,
    updateCount: 0,
    confidenceInterval: ci,
    updateHistory: [],
  };
}

/**
 * Coerce a possibly-legacy BayesianPrior into Beta(α, β) form. Used when
 * loading rows persisted under v3.0 (where α/β are absent).
 *
 *   If α/β are present → trust them.
 *   Otherwise reconstruct: α = posteriorProbability × (updateCount + strength),
 *                         β = (1 − posteriorProbability) × (updateCount + strength).
 *   This preserves the point estimate and gives the existing updates an
 *   approximate weight.
 */
export function ensureBeta(
  prior: BayesianPrior,
  strength: number = DEFAULT_PRIOR_STRENGTH,
): { alpha: number; beta: number } {
  if (typeof prior.alpha === 'number' && typeof prior.beta === 'number'
      && prior.alpha > 0 && prior.beta > 0) {
    return { alpha: prior.alpha, beta: prior.beta };
  }
  const p = clamp01(prior.posteriorProbability ?? 0.5);
  const total = (prior.updateCount ?? 0) + strength;
  // Avoid degenerate α=0 or β=0 which break the Beta CI.
  const alpha = Math.max(p * total, 1e-3);
  const beta = Math.max((1 - p) * total, 1e-3);
  return { alpha, beta };
}

/**
 * Apply one piece of evidence to a BayesianPrior.
 *
 * `evidenceConfidence ∈ [0, 1]` indicates how strongly the evidence confirms
 * the claim:
 *   1.0 = unambiguous confirmation → α += 1
 *   0.0 = unambiguous refutation   → β += 1
 *   0.5 = uninformative / undecidable → α += 0.5, β += 0.5
 *   c   = weighted: α += c, β += 1 − c
 *
 * This is a soft Bernoulli observation under the standard Beta-Bernoulli
 * conjugate update with fractional pseudo-counts.
 */
export function updateBayesianPrior(
  prior: BayesianPrior,
  evidenceId: MeasurementId | SubClaimId,
  evidenceConfidence: number,
): BayesianPrior {
  if (!Number.isFinite(evidenceConfidence)) {
    throw new Error(`updateBayesianPrior: evidenceConfidence must be finite, got ${evidenceConfidence}`);
  }
  const c = clamp01(evidenceConfidence);

  const { alpha: a0, beta: b0 } = ensureBeta(prior);
  const a1 = a0 + c;
  const b1 = b0 + (1 - c);

  const mean0 = a0 / (a0 + b0);
  const mean1 = a1 / (a1 + b1);
  const ci = betaCI95(a1, b1);

  // Likelihood ratio for the legacy update record. With a fractional Bernoulli
  // observation the LR collapses to c / (1 − c); guard against ±∞ at c = 0/1.
  const lr = c >= 1 ? Number.POSITIVE_INFINITY
           : c <= 0 ? 0
           : c / (1 - c);

  const update: BayesianUpdate = {
    timestamp: new Date().toISOString(),
    evidenceId,
    priorBefore: mean0,
    posteriorAfter: mean1,
    likelihoodRatio: lr,
    alphaBefore: a0,
    betaBefore: b0,
    alphaAfter: a1,
    betaAfter: b1,
    evidenceConfidence: c,
  };

  return {
    ...prior,
    alpha: a1,
    beta: b1,
    priorProbability: mean0,
    likelihood: c,             // legacy mirror; no longer authoritative
    counterLikelihood: 1 - c,
    posteriorProbability: mean1,
    updateCount: (prior.updateCount ?? 0) + 1,
    confidenceInterval: ci,
    updateHistory: [...(prior.updateHistory ?? []), update],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
//  Aggregation across sub-claims
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Combine sub-claim posteriors into a parent truth score using weighted
 * log-odds. Each sub-claim contributes `wᵢ · logit(pᵢ)` to a sum which is
 * then squashed back through the sigmoid:
 *
 *   logit(p_parent) = Σ wᵢ · logit(pᵢ)
 *   p_parent        = σ(logit(p_parent))
 *
 * Weights need not sum to 1 (and shouldn't be normalised: a sub-claim with
 * weight 1.0 should contribute its full evidence even if it's the only one).
 *
 * Robust to pᵢ ∈ {0, 1}: clamps to (ε, 1−ε) before the logit so a single
 * sub-claim cannot drive the whole claim to absolute certainty.
 */
export const LOGODDS_CLAMP = 0.01; // bounds a single sub-claim's vote to logit ≤ ln(99) ≈ 4.6

export function aggregateLogOdds(
  parts: ReadonlyArray<{ probability: number; weight: number }>,
): number {
  if (parts.length === 0) return 0.5;
  let sum = 0;
  for (const { probability, weight } of parts) {
    if (weight <= 0) continue;
    const p = Math.min(1 - LOGODDS_CLAMP, Math.max(LOGODDS_CLAMP, probability));
    sum += weight * Math.log(p / (1 - p));
  }
  return 1 / (1 + Math.exp(-sum));
}

/**
 * Legacy v3.0 aggregator: weighted geometric mean ∏ pᵢ^wᵢ. Retained for
 * comparison and rollback. New deployments should prefer aggregateLogOdds.
 */
export function aggregateGeometric(
  parts: ReadonlyArray<{ probability: number; weight: number }>,
): number {
  if (parts.length === 0) return 0.5;
  return parts.reduce((acc, { probability, weight }) =>
    acc * Math.pow(Math.max(0, probability), weight), 1);
}

// ─────────────────────────────────────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────────────────────────────────────

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0.5;
  return Math.min(1, Math.max(0, x));
}
