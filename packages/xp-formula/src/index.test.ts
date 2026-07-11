/**
 * Property and regression tests for the canonical XP formula (v3.1.3).
 *
 * Guarantees under test:
 *   (I1) XP is bounded for any positive input tuple.
 *   (I2) logDecay is always ≥ 0 and ≤ log(1/Tfloor).
 *   (I3) Speed-farming is impossible: Ts → 0 does not diverge.
 *   (I4) Legitimate long-settlement loops still mint > 0 (this is the
 *        regression the v3.1.2 code path silently broke by feeding raw
 *        seconds > 1 into log(1/·) and clamping negatives to zero).
 *   (I5) Raw-seconds callsites go through normalizeSettlementTime, which
 *        maps arbitrary elapsed seconds into (Tfloor, 1].
 *   (I6) Reputation cannot enter the formula (no reputation-shaped field
 *        exists in XPFormulaInputs).
 */

import { describe, expect, it } from 'vitest';
import {
  computeXP,
  computeXPFromElapsedSeconds,
  normalizeSettlementTime,
  T_FLOOR_DEFAULT,
  LOG_DECAY_CAP_DEFAULT,
  FORMULA_VERSION,
} from './index';

const base = {
  R: 1.2,
  F: 0.9,
  deltaS: 5.0,
  w: [1, 1, 1],
  E: [0.5, 0.5, 0.5],
};

describe('FORMULA_VERSION', () => {
  it('is canonical-v3.1.3', () => {
    expect(FORMULA_VERSION).toBe('canonical-v3.1.3');
  });
});

describe('normalizeSettlementTime', () => {
  it('maps zero elapsed seconds to Ts = 1', () => {
    expect(normalizeSettlementTime(0)).toBe(1);
  });
  it('maps huge elapsed seconds to Tfloor, never lower', () => {
    const ts = normalizeSettlementTime(1e12);
    expect(ts).toBe(T_FLOOR_DEFAULT);
  });
  it('always returns a value in (0, 1]', () => {
    for (const dt of [0, 1, 60, 3600, 86400, 604800, 2592000, 1e9]) {
      const ts = normalizeSettlementTime(dt);
      expect(ts).toBeGreaterThan(0);
      expect(ts).toBeLessThanOrEqual(1);
    }
  });
  it('respects a custom Tfloor', () => {
    const ts = normalizeSettlementTime(1e12, 1e-4, 0.001);
    expect(ts).toBe(0.001);
  });
});

describe('computeXP — invariants', () => {
  it('I1: xp is finite and bounded for any positive input tuple', () => {
    for (const Ts of [1, 0.5, 0.1, 0.01, 0.001, 1e-9, 1e-300]) {
      const r = computeXP({ ...base, Ts });
      expect(Number.isFinite(r.xp)).toBe(true);
      // Absolute upper bound from the canonical parameters
      const upper = base.R * base.F * base.deltaS *
        base.w.reduce((s, wi, i) => s + wi * base.E[i], 0) * LOG_DECAY_CAP_DEFAULT;
      expect(r.xp).toBeLessThanOrEqual(upper + 1e-9);
    }
  });

  it('I2: logDecay always ∈ [0, log(1/Tfloor)]', () => {
    for (const Ts of [1, 0.9, 0.5, 0.1, 0.01, 0.001, 1e-9]) {
      const r = computeXP({ ...base, Ts });
      expect(r.breakdown.logDecay).toBeGreaterThanOrEqual(0);
      expect(r.breakdown.logDecay).toBeLessThanOrEqual(LOG_DECAY_CAP_DEFAULT + 1e-12);
    }
  });

  it('I3: speed-farming is neutralized — Ts far below floor still caps', () => {
    const rFast = computeXP({ ...base, Ts: 1e-300 });
    const rFloor = computeXP({ ...base, Ts: T_FLOOR_DEFAULT });
    expect(rFast.xp).toBeCloseTo(rFloor.xp, 9);
    expect(rFast.breakdown.tsClamped).toBe(true);
    expect(rFloor.breakdown.tsClamped).toBe(false);
  });

  it('I4: long-settlement loops still mint > 0 (regression on v3.1.2)', () => {
    // A loop that took a full day. Under the v3.1.2 code path, this fed
    // Math.log(1/86400) ≈ -11.37 into the mint and was clamped to 0.
    // Under v3.1.3, the raw seconds go through normalizeSettlementTime
    // and the loop mints positive XP.
    const r = computeXPFromElapsedSeconds(base, 86400 /* 1 day */);
    expect(r.valid).toBe(true);
    expect(r.xp).toBeGreaterThan(0);
  });

  it('I4b: week-long, month-long, and year-long loops all mint > 0', () => {
    for (const dt of [604800, 2592000, 31536000]) {
      const r = computeXPFromElapsedSeconds(base, dt);
      expect(r.xp).toBeGreaterThan(0);
    }
  });
});

describe('computeXP — preconditions', () => {
  it('rejects deltaS ≤ 0', () => {
    expect(computeXP({ ...base, Ts: 0.5, deltaS: 0 }).valid).toBe(false);
    expect(computeXP({ ...base, Ts: 0.5, deltaS: -1 }).valid).toBe(false);
  });
  it('rejects Ts outside (0, 1]', () => {
    expect(computeXP({ ...base, Ts: 0 }).valid).toBe(false);
    expect(computeXP({ ...base, Ts: -0.1 }).valid).toBe(false);
    expect(computeXP({ ...base, Ts: 1.1 }).valid).toBe(false);
    expect(computeXP({ ...base, Ts: NaN }).valid).toBe(false);
    expect(computeXP({ ...base, Ts: Infinity }).valid).toBe(false);
  });
  it('rejects mismatched w and E lengths', () => {
    expect(computeXP({ ...base, w: [1, 1], E: [1, 1, 1], Ts: 0.5 }).valid).toBe(false);
    expect(computeXP({ ...base, w: [], E: [], Ts: 0.5 }).valid).toBe(false);
  });
  it('rejects out-of-band F', () => {
    expect(computeXP({ ...base, F: 0, Ts: 0.5 }).valid).toBe(false);
    expect(computeXP({ ...base, F: 1.1, Ts: 0.5 }).valid).toBe(false);
  });
});

describe('computeXP — Goodhart-resistance surface', () => {
  it('I6: XPFormulaInputs has no reputation-shaped field (compile-time)', () => {
    // Structural test: the type does not contain any reputation surface.
    // If a future PR adds one, TypeScript will reject the following.
    const inputs: import('./index').XPFormulaInputs = {
      R: 1, F: 1, deltaS: 1, w: [1], E: [1], Ts: 0.5,
    };
    // @ts-expect-error - reputation is not a field on XPFormulaInputs
    inputs.reputation = 999;
    // @ts-expect-error - rho is not a field on XPFormulaInputs
    inputs.rho = 999;
    expect(inputs.R).toBe(1);
  });

  it('monotonicity in ΔS: doubling ΔS doubles XP (all else equal)', () => {
    const a = computeXP({ ...base, Ts: 0.5 });
    const b = computeXP({ ...base, Ts: 0.5, deltaS: base.deltaS * 2 });
    expect(b.xp).toBeCloseTo(a.xp * 2, 9);
  });

  it('F acts as anti-grind penalty: F=0.1 mints 10× less than F=1', () => {
    const first = computeXP({ ...base, F: 1.0, Ts: 0.5 });
    const tenth = computeXP({ ...base, F: 0.1, Ts: 0.5 });
    expect(tenth.xp).toBeCloseTo(first.xp * 0.1, 9);
  });
});
