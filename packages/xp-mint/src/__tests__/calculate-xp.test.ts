/**
 * Parity tests: xp-mint calculateXP wrapper vs. the historical in-file
 * implementation it replaced. The wrapper now delegates to the canonical
 * @extropy/xp-formula computeXP via [domainWeight] / [essentiality]
 * one-element vectors. These tests pin that the numerical output is
 * unchanged for representative valid inputs and existing edge behavior,
 * including current T_s behavior.
 *
 * NOTE: T_s semantics (no floor, no clamp, returns 0 when Ts >= 1) are
 * deliberately preserved. Do not introduce floors, saturation, or
 * formula changes here — those are tracked separately (issue #6).
 */

import { describe, it, expect } from 'vitest';
import type { XPFormulaInputs } from '@extropy/contracts';
import { calculateXP } from '../calculate-xp';

/**
 * Verbatim copy of the previous in-file implementation. Used as the
 * oracle in parity tests so that future formula churn is forced to be
 * intentional.
 */
function legacyCalculateXP(inputs: XPFormulaInputs): number {
  const { rarity, frequencyOfDecay, deltaS, domainWeight, essentiality, settlementTimeSeconds } = inputs;
  if (deltaS <= 0) return 0;
  if (rarity <= 0 || frequencyOfDecay <= 0 || domainWeight <= 0 || essentiality <= 0) return 0;
  if (settlementTimeSeconds <= 0) return 0;
  const settlementFactor = Math.log(1 / settlementTimeSeconds);
  if (settlementFactor <= 0) return 0;
  const xp = rarity * frequencyOfDecay * deltaS * (domainWeight * essentiality) * settlementFactor;
  return Math.max(0, xp);
}

const baseInputs: XPFormulaInputs = {
  rarity: 1.2,
  frequencyOfDecay: 0.9,
  deltaS: 5.0,
  domainWeight: 1.0,
  essentiality: 0.8,
  settlementTimeSeconds: 0.5,
};

describe('xp-mint calculateXP — parity with legacy implementation', () => {
  it('matches legacy for the canonical base case', () => {
    const got = calculateXP(baseInputs);
    const want = legacyCalculateXP(baseInputs);
    expect(got).toBeCloseTo(want, 12);
    expect(got).toBeGreaterThan(0);
  });

  it('matches legacy across a representative grid of valid inputs', () => {
    const rarities = [0.5, 1.0, 1.2, 1.5, 2.0, 3.0];
    const Fs = [0.1, 0.25, 0.5, 0.9, 1.0];
    const dSs = [0.001, 0.1, 1.0, 5.0, 100.0];
    const ws = [0.1, 1.0, 2.5];
    const Es = [0.05, 0.5, 1.0];
    const Tss = [1e-6, 0.001, 0.1, 0.5, 0.999];

    for (const r of rarities) {
      for (const f of Fs) {
        for (const dS of dSs) {
          for (const w of ws) {
            for (const e of Es) {
              for (const Ts of Tss) {
                const inputs: XPFormulaInputs = {
                  rarity: r,
                  frequencyOfDecay: f,
                  deltaS: dS,
                  domainWeight: w,
                  essentiality: e,
                  settlementTimeSeconds: Ts,
                };
                const got = calculateXP(inputs);
                const want = legacyCalculateXP(inputs);
                // Relative tolerance: both implementations should be
                // numerically identical modulo floating-point reordering
                // of multiplications.
                expect(got).toBeCloseTo(want, 10);
              }
            }
          }
        }
      }
    }
  });
});

describe('xp-mint calculateXP — preserved edge behavior (do not change)', () => {
  it('returns 0 when deltaS is zero', () => {
    expect(calculateXP({ ...baseInputs, deltaS: 0 })).toBe(0);
  });

  it('returns 0 when deltaS is negative', () => {
    expect(calculateXP({ ...baseInputs, deltaS: -1 })).toBe(0);
  });

  it('returns 0 when rarity is zero', () => {
    expect(calculateXP({ ...baseInputs, rarity: 0 })).toBe(0);
  });

  it('returns 0 when rarity is negative', () => {
    expect(calculateXP({ ...baseInputs, rarity: -1 })).toBe(0);
  });

  it('returns 0 when frequencyOfDecay is zero or negative', () => {
    expect(calculateXP({ ...baseInputs, frequencyOfDecay: 0 })).toBe(0);
    expect(calculateXP({ ...baseInputs, frequencyOfDecay: -0.5 })).toBe(0);
  });

  it('returns 0 when domainWeight is zero or negative', () => {
    expect(calculateXP({ ...baseInputs, domainWeight: 0 })).toBe(0);
    expect(calculateXP({ ...baseInputs, domainWeight: -1 })).toBe(0);
  });

  it('returns 0 when essentiality is zero or negative', () => {
    expect(calculateXP({ ...baseInputs, essentiality: 0 })).toBe(0);
    expect(calculateXP({ ...baseInputs, essentiality: -0.1 })).toBe(0);
  });

  it('T_s behavior: returns 0 when settlementTimeSeconds is zero', () => {
    expect(calculateXP({ ...baseInputs, settlementTimeSeconds: 0 })).toBe(0);
  });

  it('T_s behavior: returns 0 when settlementTimeSeconds is negative', () => {
    expect(calculateXP({ ...baseInputs, settlementTimeSeconds: -1 })).toBe(0);
  });

  it('T_s behavior: returns 0 when settlementTimeSeconds equals 1 (log(1/1) = 0)', () => {
    // No floor, no clamp, no T_s saturation — exact-equality with legacy.
    const got = calculateXP({ ...baseInputs, settlementTimeSeconds: 1 });
    const want = legacyCalculateXP({ ...baseInputs, settlementTimeSeconds: 1 });
    expect(got).toBe(0);
    expect(got).toBe(want);
  });

  it('T_s behavior: returns 0 when settlementTimeSeconds > 1 (log < 0 path)', () => {
    // Historical behavior: settlementFactor <= 0 short-circuits to 0.
    // Canonical computeXP rejects Ts > 1 as invalid, which the wrapper
    // also maps to 0 — same observable result.
    const got = calculateXP({ ...baseInputs, settlementTimeSeconds: 2 });
    const want = legacyCalculateXP({ ...baseInputs, settlementTimeSeconds: 2 });
    expect(got).toBe(0);
    expect(got).toBe(want);
  });

  it('T_s behavior: very small Ts produces large XP (no saturation/clamp)', () => {
    // 1e-9 -> log(1e9) ~= 20.72 — this is a lot of XP. Legacy and
    // wrapper must match exactly; do NOT introduce a T_s floor.
    const inputs: XPFormulaInputs = { ...baseInputs, settlementTimeSeconds: 1e-9 };
    const got = calculateXP(inputs);
    const want = legacyCalculateXP(inputs);
    expect(got).toBeCloseTo(want, 8);
    expect(got).toBeGreaterThan(50);
  });
});

describe('xp-mint calculateXP — canonical formula identity', () => {
  it('computes XP = R * F * ΔS * (w * E) * log(1/Ts) exactly', () => {
    const inputs: XPFormulaInputs = {
      rarity: 2,
      frequencyOfDecay: 0.5,
      deltaS: 4,
      domainWeight: 1,
      essentiality: 1,
      settlementTimeSeconds: Math.exp(-1), // log(1/Ts) = 1
    };
    // Expected: 2 * 0.5 * 4 * (1 * 1) * 1 = 4
    expect(calculateXP(inputs)).toBeCloseTo(4, 10);
  });
});
