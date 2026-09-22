import { describe, it, expect } from 'vitest';
import { packageClaim, closeLoop } from './lib.js';

describe('SignalFlow packager', () => {
  it('faces do not mint — packaging only', () => {
    const packed = packageClaim({ face: 'localflow', class: 'errand.ride' });
    expect(packed.strip.state).toBe('open');
    expect(packed.look.blind).toBe(true);
    expect(packed.look.parts).toBe(10);
  });

  it('fail-closed without both edges', () => {
    const packed = packageClaim({ face: 'homeflow', class: 'home.chore' });
    expect(closeLoop(packed, { bothSigned: false, deltaTSeconds: 60 }).minted).toBe(false);
  });

  it('instant close slams to 0', () => {
    const packed = packageClaim({ face: 'quest-market', class: 'quest.micro' });
    const closed = closeLoop(packed, { bothSigned: true, deltaTSeconds: 0 });
    expect(closed.minted).toBe(false);
  });

  it('both edges + elapsed time mints from kernel', () => {
    const packed = packageClaim({ face: 'localflow', class: 'errand.ride' });
    const closed = closeLoop(packed, { bothSigned: true, deltaTSeconds: 180 });
    expect(closed.minted).toBe(true);
  });
});
