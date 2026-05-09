/**
 * Tests for the v3.1 Beta(α, β) Bayesian math.
 *
 * Validates:
 *  - Beta CDF / quantile against known reference values
 *  - Conjugate updates produce the expected α, β, mean
 *  - Credible interval shrinks with evidence
 *  - Log-odds aggregation is well-behaved at 0/1 and matches algebra
 *  - ensureBeta back-compat reconstruction
 */

import { describe, it, expect } from 'vitest';
import {
  betaCdf,
  betaQuantile,
  betaCI95,
  initBayesianPrior,
  updateBayesianPrior,
  ensureBeta,
  aggregateLogOdds,
  aggregateGeometric,
  JEFFREYS_PRIOR,
} from '../index.js';
import type { MeasurementId } from '@extropy/contracts';

const evid = (n: number) => `m${n}` as MeasurementId;

describe('betaCdf', () => {
  it('matches uniform Beta(1,1): CDF(x; 1, 1) = x', () => {
    for (const x of [0.1, 0.25, 0.5, 0.75, 0.9]) {
      expect(betaCdf(x, 1, 1)).toBeCloseTo(x, 10);
    }
  });

  it('handles boundaries', () => {
    expect(betaCdf(0, 2, 3)).toBe(0);
    expect(betaCdf(1, 2, 3)).toBe(1);
  });

  it('matches reference value for Beta(2,3) at x=0.5: I_0.5(2,3) = 0.6875', () => {
    expect(betaCdf(0.5, 2, 3)).toBeCloseTo(0.6875, 8);
  });

  it('matches reference value for Beta(5,5) at x=0.5: 0.5 by symmetry', () => {
    expect(betaCdf(0.5, 5, 5)).toBeCloseTo(0.5, 10);
  });

  it('matches reference for Beta(0.5,0.5) at x=0.5: arcsine CDF gives 0.5', () => {
    expect(betaCdf(0.5, 0.5, 0.5)).toBeCloseTo(0.5, 8);
  });
});

describe('betaQuantile', () => {
  it('inverts betaCdf', () => {
    const cases: Array<[number, number, number]> = [
      [0.025, 2, 3],
      [0.975, 2, 3],
      [0.5, 5, 5],
      [0.1, 1, 1],
      [0.9, 1, 1],
      [0.5, 10, 90],
    ];
    for (const [p, a, b] of cases) {
      const x = betaQuantile(p, a, b);
      expect(betaCdf(x, a, b)).toBeCloseTo(p, 8);
    }
  });

  it('Beta(1,1) quantile is the identity', () => {
    expect(betaQuantile(0.3, 1, 1)).toBeCloseTo(0.3, 10);
    expect(betaQuantile(0.7, 1, 1)).toBeCloseTo(0.7, 10);
  });
});

describe('betaCI95', () => {
  it('Beta(1,1) gives [0.025, 0.975]', () => {
    const [lo, hi] = betaCI95(1, 1);
    expect(lo).toBeCloseTo(0.025, 10);
    expect(hi).toBeCloseTo(0.975, 10);
  });

  it('CI shrinks with strong evidence', () => {
    const [lo1, hi1] = betaCI95(2, 2);
    const [lo2, hi2] = betaCI95(20, 20);
    const [lo3, hi3] = betaCI95(200, 200);
    expect(hi1 - lo1).toBeGreaterThan(hi2 - lo2);
    expect(hi2 - lo2).toBeGreaterThan(hi3 - lo3);
    // All three should be centred near 0.5
    expect((lo3 + hi3) / 2).toBeCloseTo(0.5, 6);
  });
});

describe('initBayesianPrior', () => {
  it('defaults to Jeffreys Beta(½, ½) when no prior probability given', () => {
    const p = initBayesianPrior();
    expect(p.alpha).toBe(JEFFREYS_PRIOR.alpha);
    expect(p.beta).toBe(JEFFREYS_PRIOR.beta);
    expect(p.posteriorProbability).toBeCloseTo(0.5, 10);
  });

  it('encodes prior probability + strength as Beta(p·n, (1-p)·n)', () => {
    const p = initBayesianPrior(0.7, 10);
    expect(p.alpha).toBeCloseTo(7, 10);
    expect(p.beta).toBeCloseTo(3, 10);
    expect(p.posteriorProbability).toBeCloseTo(0.7, 10);
  });

  it('rejects degenerate priors', () => {
    expect(() => initBayesianPrior(0)).toThrow();
    expect(() => initBayesianPrior(1)).toThrow();
    expect(() => initBayesianPrior(0.5, 0)).toThrow();
  });

  it('produces a valid CI', () => {
    const p = initBayesianPrior(0.5, 4);
    const [lo, hi] = p.confidenceInterval;
    expect(lo).toBeGreaterThan(0);
    expect(hi).toBeLessThan(1);
    expect(lo).toBeLessThan(0.5);
    expect(hi).toBeGreaterThan(0.5);
  });
});

describe('updateBayesianPrior', () => {
  it('a confirming observation increments α by 1, β by 0', () => {
    const p0 = initBayesianPrior(0.5, 2);
    const p1 = updateBayesianPrior(p0, evid(1), 1.0);
    expect(p1.alpha).toBeCloseTo((p0.alpha ?? 0) + 1, 10);
    expect(p1.beta).toBeCloseTo(p0.beta ?? 0, 10);
  });

  it('a refuting observation increments β by 1, α by 0', () => {
    const p0 = initBayesianPrior(0.5, 2);
    const p1 = updateBayesianPrior(p0, evid(1), 0.0);
    expect(p1.alpha).toBeCloseTo(p0.alpha ?? 0, 10);
    expect(p1.beta).toBeCloseTo((p0.beta ?? 0) + 1, 10);
  });

  it('a half-confidence observation splits 0.5/0.5', () => {
    const p0 = initBayesianPrior(0.5, 2);
    const p1 = updateBayesianPrior(p0, evid(1), 0.5);
    expect(p1.alpha).toBeCloseTo((p0.alpha ?? 0) + 0.5, 10);
    expect(p1.beta).toBeCloseTo((p0.beta ?? 0) + 0.5, 10);
  });

  it('repeated confirming evidence drives the posterior to 1', () => {
    let p = initBayesianPrior(0.5, 2);
    for (let i = 0; i < 100; i++) p = updateBayesianPrior(p, evid(i), 1.0);
    expect(p.posteriorProbability).toBeGreaterThan(0.95);
  });

  it('repeated refuting evidence drives the posterior to 0', () => {
    let p = initBayesianPrior(0.5, 2);
    for (let i = 0; i < 100; i++) p = updateBayesianPrior(p, evid(i), 0.0);
    expect(p.posteriorProbability).toBeLessThan(0.05);
  });

  it('mixed evidence converges to the true rate', () => {
    let p = initBayesianPrior(0.5, 2);
    // 70% true, 30% false
    for (let i = 0; i < 200; i++) {
      p = updateBayesianPrior(p, evid(i), i % 10 < 7 ? 1.0 : 0.0);
    }
    expect(p.posteriorProbability).toBeGreaterThan(0.65);
    expect(p.posteriorProbability).toBeLessThan(0.75);
  });

  it('CI shrinks monotonically with more evidence', () => {
    let p = initBayesianPrior(0.5, 2);
    let prevWidth = Infinity;
    for (let i = 0; i < 50; i++) {
      p = updateBayesianPrior(p, evid(i), 1.0);
      const width = p.confidenceInterval[1] - p.confidenceInterval[0];
      expect(width).toBeLessThanOrEqual(prevWidth);
      prevWidth = width;
    }
  });

  it('appends update history with α/β before-and-after', () => {
    const p0 = initBayesianPrior(0.5, 2);
    const p1 = updateBayesianPrior(p0, evid(1), 0.8);
    const u = p1.updateHistory[p1.updateHistory.length - 1];
    expect(u).toBeDefined();
    expect(u!.alphaBefore).toBeCloseTo(1, 10);
    expect(u!.betaBefore).toBeCloseTo(1, 10);
    expect(u!.alphaAfter).toBeCloseTo(1.8, 10);
    expect(u!.betaAfter).toBeCloseTo(1.2, 10);
    expect(u!.evidenceConfidence).toBe(0.8);
  });

  it('clamps non-finite confidence', () => {
    const p0 = initBayesianPrior(0.5, 2);
    expect(() => updateBayesianPrior(p0, evid(1), NaN)).toThrow();
    expect(() => updateBayesianPrior(p0, evid(1), Infinity)).toThrow();
  });
});

describe('ensureBeta (v3.0 back-compat)', () => {
  it('trusts existing α/β when both present and positive', () => {
    const v31Prior = initBayesianPrior(0.7, 5);
    const { alpha, beta } = ensureBeta(v31Prior);
    expect(alpha).toBe(v31Prior.alpha);
    expect(beta).toBe(v31Prior.beta);
  });

  it('reconstructs Beta from a v3.0 record without α/β', () => {
    // Simulate a v3.0 record: no alpha/beta
    const v30Prior = {
      priorProbability: 0.5,
      likelihood: 0.8,
      counterLikelihood: 0.2,
      posteriorProbability: 0.75,
      updateCount: 4,
      confidenceInterval: [0.5, 0.95] as [number, number],
      updateHistory: [],
    };
    const { alpha, beta } = ensureBeta(v30Prior, 2);
    // total pseudo-count = updateCount + strength = 6
    expect(alpha).toBeCloseTo(0.75 * 6, 10);
    expect(beta).toBeCloseTo(0.25 * 6, 10);
  });
});

describe('aggregateLogOdds', () => {
  it('returns 0.5 on empty input', () => {
    expect(aggregateLogOdds([])).toBe(0.5);
  });

  it('a single sub-claim with weight 1 returns its own probability', () => {
    expect(aggregateLogOdds([{ probability: 0.7, weight: 1 }])).toBeCloseTo(0.7, 8);
    expect(aggregateLogOdds([{ probability: 0.3, weight: 1 }])).toBeCloseTo(0.3, 8);
  });

  it('two sub-claims at 0.5 with any weights stay at 0.5', () => {
    expect(aggregateLogOdds([
      { probability: 0.5, weight: 0.4 },
      { probability: 0.5, weight: 0.6 },
    ])).toBeCloseTo(0.5, 10);
  });

  it('does NOT collapse to zero on a single low sub-claim (the bug we fixed)', () => {
    // Geometric: 0.01 × 0.99 = 0.0099. Log-odds: a single 0.99 dominates.
    const logodds = aggregateLogOdds([
      { probability: 0.01, weight: 0.5 },
      { probability: 0.99, weight: 0.5 },
    ]);
    const geom = aggregateGeometric([
      { probability: 0.01, weight: 0.5 },
      { probability: 0.99, weight: 0.5 },
    ]);
    expect(logodds).toBeCloseTo(0.5, 8); // log-odds: symmetric → 0.5
    expect(geom).toBeLessThan(0.15);     // geometric: collapses
  });

  it('clamps probabilities so a single 0 with low weight cannot dominate', () => {
    const result = aggregateLogOdds([
      { probability: 0, weight: 0.1 },     // strongly refuted, low weight
      { probability: 0.9, weight: 0.9 },   // strongly confirmed, high weight
    ]);
    // With LOGODDS_CLAMP = 0.01, the 0→10.99 logit ≈ –4.6 × 0.1 = –0.46;
    // the 0.9 logit ≈ +2.197 × 0.9 = +1.98. Net positive → > 0.5.
    expect(result).toBeGreaterThan(0.5);
  });

  it('a single 0 at full weight still pulls the score down without going to 0', () => {
    const result = aggregateLogOdds([{ probability: 0, weight: 1 }]);
    // Clamped to LOGODDS_CLAMP = 0.01
    expect(result).toBeCloseTo(0.01, 4);
  });

  it('ignores zero-weight sub-claims', () => {
    const a = aggregateLogOdds([
      { probability: 0.6, weight: 1 },
      { probability: 0.99, weight: 0 },
    ]);
    expect(a).toBeCloseTo(0.6, 8);
  });
});
