import { describe, it, expect } from 'vitest';
import { computeXP, FORMULA_VERSION as CANONICAL_VERSION } from '@extropy/xp-formula';
import {
  computeLocalflowXP,
  computeEP,
  settleFromNormalized,
  FORMULA_VERSION,
} from '../xp.js';
import { EntropyDomain } from '@extropy/contracts';
import type { NormalizedMeasurement } from '../types.js';

describe('computeLocalflowXP', () => {
  it('delegates to the canonical @extropy/xp-formula package', () => {
    const inputs = {
      R: 0.8,
      F: 1.0,
      deltaS: 0.5,
      w: [0, 0, 0, 0.5, 0, 0, 0, 0.5],
      E: [0, 0, 0, 0.5, 0, 0, 0, 0.5],
      Ts: 0.3,
    };
    const local = computeLocalflowXP(inputs);
    const canonical = computeXP(inputs);
    expect(local).toEqual(canonical);
    expect(local.formulaVersion).toBe(CANONICAL_VERSION);
    expect(FORMULA_VERSION).toBe(CANONICAL_VERSION);
  });

  it('returns invalid when the canonical formula rejects inputs', () => {
    const result = computeLocalflowXP({
      R: 0,
      F: 1,
      deltaS: 1,
      w: [1, 0, 0, 0, 0, 0, 0, 0],
      E: [1, 0, 0, 0, 0, 0, 0, 0],
      Ts: 0.5,
    });
    expect(result.valid).toBe(false);
    expect(result.xp).toBe(0);
  });
});

describe('computeEP', () => {
  it('is always xp * L', () => {
    expect(computeEP(10, 1.5)).toBeCloseTo(15);
  });
});

describe('settleFromNormalized', () => {
  const validMeasurement: NormalizedMeasurement = {
    domain: EntropyDomain.ECONOMIC,
    inputs: {
      R: 0.8,
      F: 1.0,
      deltaS: 0.7,
      w: [0, 0, 0, 0.5, 0, 0, 0, 0.5],
      E: [0, 0, 0, 0.5, 0, 0, 0, 0.5],
      Ts: 0.2,
    },
    normalizedBy: 'test-validator',
    simulated: false,
    normalizedAt: new Date().toISOString(),
  };

  it('produces positive xp and ep from a valid normalized measurement', () => {
    const result = settleFromNormalized(validMeasurement, 1.5);
    expect(result).not.toBeNull();
    expect(result!.xp).toBeGreaterThan(0);
    expect(result!.ep).toBeCloseTo(result!.xp * 1.5);
    expect(result!.formulaVersion).toBe(CANONICAL_VERSION);
  });

  it('returns null when the normalized inputs are invalid', () => {
    const bad: NormalizedMeasurement = {
      ...validMeasurement,
      inputs: { ...validMeasurement.inputs, deltaS: 0 },
    };
    expect(settleFromNormalized(bad)).toBeNull();
  });
});
