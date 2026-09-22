import { describe, it, expect } from 'vitest';
import { computeXP, computeLocalflowLoop } from '../xp.js';
import { closeLoop, packageClaim } from '@extropy/signalflow';

describe('kernel XP via localflow', () => {
  it('returns 0 when deltaS is 0', () => {
    expect(computeXP({ R: 1, F: 1, deltaS: 0, w: [1,0,0,0,0,0,0,0], E: [1,0,0,0,0,0,0,0], Ts: 0.5 })).toBe(0);
  });

  it('instant close Ts=1 mints 0 (slam window)', () => {
    expect(computeXP({ R: 1, F: 1, deltaS: 1, w: [1,0,0,0,0,0,0,0], E: [1,0,0,0,0,0,0,0], Ts: 1 })).toBe(0);
  });

  it('fail-closed when both edges are missing', () => {
    const packed = packageClaim({ face: 'localflow', class: 'errand.ride' });
    const closed = closeLoop(packed, { bothSigned: false, deltaTSeconds: 120 });
    expect(closed.minted).toBe(false);
  });

  it('packages through SignalFlow then mints when both edges signed', () => {
    const packed = packageClaim({ face: 'localflow', class: 'errand.ride' });
    const closed = closeLoop(packed, { bothSigned: true, deltaTSeconds: 120 });
    expect(closed.minted).toBe(true);
    if (closed.minted) expect(closed.xp).toBeGreaterThan(0);
  });
});

describe('computeLocalflowLoop', () => {
  it('EP is a spark from the kernel, not XP × L with L>1', () => {
    const result = computeLocalflowLoop({ deltaS: 0.5, Ts: 0.4 });
    expect(result.L).toBeLessThanOrEqual(1);
    expect(result.ep).toBeGreaterThanOrEqual(0);
  });
});
