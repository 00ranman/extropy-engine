import { describe, it, expect } from 'vitest';
import { computeXP, computeLocalflowLoop } from '../xp.js';

describe('computeXP', () => {
  it('returns 0 when R is 0', () => {
    expect(computeXP({ R: 0, F: 1, deltaS: 1, w: [1,0,0,0,0,0,0,0], E: [1,0,0,0,0,0,0,0], Ts: 0.5 })).toBe(0);
  });

  it('returns 0 when deltaS is 0', () => {
    expect(computeXP({ R: 1, F: 1, deltaS: 0, w: [1,0,0,0,0,0,0,0], E: [1,0,0,0,0,0,0,0], Ts: 0.5 })).toBe(0);
  });

  it('produces a positive result for valid inputs', () => {
    const xp = computeXP({ R: 0.8, F: 1.0, deltaS: 0.5, w: [0,0,0,0.5,0,0,0,0.5], E: [0,0,0,0.5,0,0,0,0.5], Ts: 0.3 });
    expect(xp).toBeGreaterThan(0);
  });

  it('faster settlement yields higher XP than slower settlement', () => {
    const fast = computeXP({ R: 1, F: 1, deltaS: 1, w: [0,0,0,1,0,0,0,0], E: [0,0,0,1,0,0,0,0], Ts: 0.1 });
    const slow = computeXP({ R: 1, F: 1, deltaS: 1, w: [0,0,0,1,0,0,0,0], E: [0,0,0,1,0,0,0,0], Ts: 0.9 });
    expect(fast).toBeGreaterThan(slow);
  });
});

describe('computeLocalflowLoop', () => {
  it('returns positive xp and ep for a fast errand', () => {
    const result = computeLocalflowLoop({ deltaS: 0.7, Ts: 0.2 });
    expect(result.xp).toBeGreaterThan(0);
    expect(result.ep).toBeGreaterThan(result.xp);
  });

  it('ep is always xp * L', () => {
    const L = 1.5;
    const result = computeLocalflowLoop({ deltaS: 0.5, Ts: 0.4 }, L);
    expect(result.ep).toBeCloseTo(result.xp * L);
  });
});
