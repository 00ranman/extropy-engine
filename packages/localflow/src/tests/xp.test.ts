import { describe, it, expect } from 'vitest';
import { computeLocalflowLoop } from '../xp.js';
import { closeLoop, packageClaim } from '@extropy/signalflow';

describe('localflow goes through SignalFlow', () => {
  it('deltaS 0 does not mint', () => {
    const packed = packageClaim({ face: 'localflow', class: 'errand.ride', instrumentDeltaS: 0 });
    expect(closeLoop(packed, { bothSigned: true, deltaTSeconds: 120 }).minted).toBe(false);
  });

  it('instant close slams to 0', () => {
    const packed = packageClaim({ face: 'localflow', class: 'errand.ride', instrumentDeltaS: 1 });
    expect(closeLoop(packed, { bothSigned: true, deltaTSeconds: 0 }).minted).toBe(false);
  });

  it('fail-closed when both edges are missing', () => {
    const packed = packageClaim({ face: 'localflow', class: 'errand.ride' });
    expect(closeLoop(packed, { bothSigned: false, deltaTSeconds: 120 }).minted).toBe(false);
  });

  it('both edges + elapsed time mints', () => {
    const packed = packageClaim({ face: 'localflow', class: 'errand.ride' });
    const closed = closeLoop(packed, { bothSigned: true, deltaTSeconds: 120 });
    expect(closed.minted).toBe(true);
    if (closed.minted) expect(closed.xp).toBeGreaterThan(0);
  });
});

describe('computeLocalflowLoop', () => {
  it('EP is a spark, L clipped', () => {
    const result = computeLocalflowLoop({ deltaS: 0.5, deltaTSeconds: 120 });
    expect(result.minted).toBe(true);
    expect(result.L).toBeLessThanOrEqual(1);
    expect(result.ep).toBeGreaterThanOrEqual(0);
  });
});
