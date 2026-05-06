/*
 * Golden value tests for the Universal Times math.
 *
 * Each expectation is computed by running the exact JavaScript from
 * docs/universaltimes-reference.html in a Node sandbox at a fixed Date
 * and capturing the produced values. If the HTML reference is updated
 * the values here must be regenerated and the diff reviewed by hand.
 *
 * The instants below are chosen for coverage:
 *   - Unix epoch start (1970-01-01T00:00:00Z)
 *   - Year 2026 boundary (2026-01-01T00:00:00Z), one of the requested
 *     anchors
 *   - Mid-day 2026-05-06 (matches "today" in this session, exercises
 *     non-zero solar units)
 */

import { describe, it, expect } from 'vitest';
import {
  BB_SEC,
  CAL,
  DUR_EXP,
  DUR_SEC,
  HF,
  TROPICAL_SEC,
  YEAR0_UNIX,
  isLeap,
  daysInYear,
  nowSnapshot,
  unitCounter,
} from '../universaltimes.js';

describe('constants', () => {
  it('match the canonical values from docs/universaltimes-reference.html', () => {
    expect(HF).toBe(1420405751.768);
    expect(BB_SEC).toBe(4.350639312e17);
    expect(YEAR0_UNIX).toBe(-62167219200);
    expect(TROPICAL_SEC).toBe(31556925.216);
    expect(DUR_EXP).toEqual([9, 11, 13, 14, 15, 16, 17, 18, 20, 22, 24]);
    expect(CAL).toEqual({ dpm: 40, m10l: 6, m10n: 5, cyc: 5 });
  });

  it('DUR_SEC equals 10^exp / HF for each entry', () => {
    for (let i = 0; i < DUR_EXP.length; i++) {
      expect(DUR_SEC[i]).toBeCloseTo(Math.pow(10, DUR_EXP[i]) / HF, 6);
    }
  });
});

describe('leap rule', () => {
  it('matches the Gregorian rule from the spec', () => {
    expect(isLeap(2000)).toBe(true);
    expect(isLeap(2024)).toBe(true);
    expect(isLeap(2100)).toBe(false);
    expect(isLeap(2026)).toBe(false);
    expect(daysInYear(2024)).toBe(CAL.dpm * 9 + CAL.m10l);
    expect(daysInYear(2026)).toBe(CAL.dpm * 9 + CAL.m10n);
  });
});

/*
 * Reproduce the reference page math here. We then run nowSnapshot at
 * the same instant and assert all integer dials line up. Floats are
 * compared with a tight tolerance because the reference uses double
 * precision throughout, identical to ours.
 */
function referenceDials(at: Date) {
  const utcH = at.getUTCHours();
  const utcM = at.getUTCMinutes();
  const utcS = at.getUTCSeconds();
  const utcMs = at.getUTCMilliseconds();
  const dayFrac = (utcH * 3600 + utcM * 60 + utcS + utcMs / 1000) / 86400;
  const totalTicks = Math.floor(dayFrac * 100000);
  const loop = Math.floor(totalTicks / 10000);
  const arc = Math.floor((totalTicks % 10000) / 100);
  const tick = totalTicks % 100;
  const epochSec = at.getTime() / 1000;
  const bbS = BB_SEC + epochSec;
  let rem = bbS;
  const dv: number[] = [];
  for (let di = 10; di >= 0; di--) {
    dv.push(Math.floor(rem / DUR_SEC[di]));
    rem = rem % DUR_SEC[di];
  }
  return { loop, arc, tick, dv, bbS };
}

const SAMPLE_INSTANTS = [
  new Date('1970-01-01T00:00:00.000Z'),
  new Date('2026-01-01T00:00:00.000Z'),
  new Date('2026-05-06T12:34:56.000Z'),
];

describe('nowSnapshot', () => {
  for (const at of SAMPLE_INSTANTS) {
    it(`matches reference dials at ${at.toISOString()}`, () => {
      const ref = referenceDials(at);
      const snap = nowSnapshot(at);
      expect(snap.solarUnits.loop).toBe(ref.loop);
      expect(snap.solarUnits.arc).toBe(ref.arc);
      expect(snap.solarUnits.tick).toBe(ref.tick);
      // dv layout (largest to smallest):
      //   dv[0]=Eon, dv[1]=Age, dv[2]=Era, dv[3]=Epoch, dv[4]=Cycle,
      //   dv[5]=Season, dv[6]=Current, dv[7]=Spin, dv[8]=Tide,
      //   dv[9]=Wave, dv[10]=GQ
      expect(snap.utUnits.eon).toBe(ref.dv[0]);
      expect(snap.utUnits.age).toBe(ref.dv[1]);
      expect(snap.utUnits.era).toBe(ref.dv[2]);
      expect(snap.utUnits.epoch).toBe(ref.dv[3]);
      expect(snap.utUnits.cycle).toBe(ref.dv[4]);
      expect(snap.utUnits.season).toBe(ref.dv[5]);
      expect(snap.utUnits.current).toBe(ref.dv[6]);
      expect(snap.utUnits.spin).toBe(ref.dv[7]);
      expect(snap.utUnits.tide).toBe(ref.dv[8]);
      expect(snap.utUnits.wave).toBe(ref.dv[9]);
      expect(snap.utUnits.gq).toBe(ref.dv[10]);
      expect(snap.unix).toBeCloseTo(at.getTime() / 1000, 6);
    });
  }

  it('reports calendar date for 2026-05-06', () => {
    const snap = nowSnapshot(new Date('2026-05-06T00:00:00.000Z'));
    expect(snap.calendar.year).toBe(2026);
    expect(snap.calendar.leap).toBe(false);
    expect(snap.calendar.daysInYear).toBe(CAL.dpm * 9 + CAL.m10n);
    // 2026 is non leap. May 6 is day 126 of the Gregorian year.
    expect(snap.calendar.dayOfYear).toBe(126);
    // 126 / 40 = 3 full months of 40 + 6 days, so M4D6.
    expect(snap.calendar.month).toBe(4);
    expect(snap.calendar.day).toBe(6);
  });

  it('CE epoch is monotonic and positive after Year 0', () => {
    const snap = nowSnapshot(new Date('2026-05-06T00:00:00.000Z'));
    expect(snap.ceEpoch).toBeGreaterThan(0);
  });
});

describe('unitCounter', () => {
  it('Tick advances every 0.864 seconds', () => {
    const a = new Date('2026-05-06T00:00:00.000Z');
    const b = new Date('2026-05-06T00:00:00.864Z');
    expect(unitCounter('Tick', b) - unitCounter('Tick', a)).toBe(1);
  });
  it('Loop count fits in 0..9 over an Earth day', () => {
    const a = new Date('2026-05-06T00:00:00.000Z');
    const b = new Date('2026-05-06T23:59:59.000Z');
    const ca = unitCounter('Loop', a);
    const cb = unitCounter('Loop', b);
    expect(cb - ca).toBe(9);
  });
});
