/*
 * Universal Times math.
 *
 * Verbatim port of the JavaScript in docs/universaltimes-reference.html.
 * That HTML page is the canonical spec. Constants and arithmetic must
 * stay byte for byte identical so the service /now endpoint matches what
 * a user sees on extropyengine.com/universaltimes.html at the same instant.
 */

export const TPD = 100000;
export const LOOPS = 10;
export const ARCS = 100;
export const TPA = 100;
export const EDS = 86400;
export const HF = 1420405751.768;
export const BB_SEC = 4.350639312e17;
export const TROPICAL_SEC = 31556925.216;
export const SHORT_DAY_SEC = 20925.216;
export const YEAR0_UNIX = -62167219200;

export const DUR_NAMES = ['GQ', 'Wave', 'Tide', 'Spin', 'Current', 'Season', 'Orbit', 'Epoch', 'Era', 'Age', 'Eon'] as const;
export const DUR_EXP = [9, 11, 13, 14, 15, 16, 17, 18, 20, 22, 24];
export const DUR_SEC: number[] = DUR_EXP.map((e) => Math.pow(10, e) / HF);

export const CAL = { dpm: 40, m10l: 6, m10n: 5, cyc: 5 } as const;

export type DurUnitName = (typeof DUR_NAMES)[number];
export type SolarUnitName = 'Loop' | 'Arc' | 'Tick';
export type CycleUnitName = 'Cycle';
export type AnyUnitName = DurUnitName | SolarUnitName | CycleUnitName;

export const ALL_UNITS: AnyUnitName[] = [
  ...DUR_NAMES,
  'Cycle',
  'Loop',
  'Arc',
  'Tick',
];

export interface UtUnits {
  eon: number;
  age: number;
  era: number;
  epoch: number;
  cycle: number;
  season: number;
  current: number;
  spin: number;
  tide: number;
  wave: number;
  gq: number;
  orbit: number;
}

export interface SolarUnits {
  loop: number;
  arc: number;
  tick: number;
}

export interface CalendarUnits {
  year: number;
  month: number;
  day: number;
  dayOfYear: number;
  daysInYear: number;
  leap: boolean;
}

export interface Fractions {
  dayFrac: number;
  loopFrac: number;
  arcFrac: number;
  tickFrac: number;
  waveFrac: number;
  tideFrac: number;
  currentFrac: number;
  seasonFrac: number;
  epochFrac: number;
}

export interface NowSnapshot {
  unix: number;
  iso: string;
  utUnits: UtUnits;
  solarUnits: SolarUnits;
  calendar: CalendarUnits;
  fractions: Fractions;
  bbQuants: string;
  ceEpoch: number;
}

export function isLeap(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

export function daysInYear(y: number): number {
  return CAL.dpm * 9 + (isLeap(y) ? CAL.m10l : CAL.m10n);
}

export function dayOfYear(d: Date): number {
  const jan1 = Date.UTC(d.getUTCFullYear(), 0, 1);
  return Math.floor((d.getTime() - jan1) / 86400000) + 1;
}

export function utDate(doy: number, y: number): { month: number; day: number } {
  let r = doy;
  for (let m = 1; m <= 10; m++) {
    const md = m <= 9 ? CAL.dpm : isLeap(y) ? CAL.m10l : CAL.m10n;
    if (r <= md) return { month: m, day: r };
    r -= md;
  }
  return { month: 10, day: 1 };
}

/*
 * Compute every Universal Times reading for a given UTC instant.
 *
 * The HTML reference uses the local Date getHours / getMinutes for the
 * solar fractions. We use UTC consistently here so the service is
 * deterministic regardless of the host timezone. Solar units are tied to
 * the Earth day so UTC is the correct reference.
 */
export function nowSnapshot(at: Date = new Date()): NowSnapshot {
  const utcH = at.getUTCHours();
  const utcM = at.getUTCMinutes();
  const utcS = at.getUTCSeconds();
  const utcMs = at.getUTCMilliseconds();
  const dayFrac = (utcH * 3600 + utcM * 60 + utcS + utcMs / 1000) / EDS;

  const totalTicks = Math.floor(dayFrac * TPD);
  const loop = Math.floor(totalTicks / (ARCS * TPA));
  const arc = Math.floor((totalTicks % (ARCS * TPA)) / TPA);
  const tick = totalTicks % TPA;
  const loopFrac = totalTicks / TPD;
  const arcFrac = (totalTicks % (ARCS * TPA)) / (ARCS * TPA);
  const tickFrac = (totalTicks % TPA) / TPA;

  const epochSec = at.getTime() / 1000;
  const bbS = BB_SEC + epochSec;

  const waveFrac = (bbS % DUR_SEC[2]) / DUR_SEC[2];
  const tideFrac = (bbS % DUR_SEC[3]) / DUR_SEC[3];
  const currentFrac = tideFrac;
  const seasonFrac = (bbS % DUR_SEC[5]) / DUR_SEC[5];
  const epochFrac = (bbS % DUR_SEC[7]) / DUR_SEC[7];

  /*
   * Walk the duration units from largest to smallest. The reference
   * iterates di from 10 down to 0 against DUR_SEC and pushes Math.floor
   * of the running remainder. This produces an 11-entry array dv[] with:
   *   dv[0] = Eon, dv[1] = Age, dv[2] = Era, dv[3] = Epoch,
   *   dv[4] = Cycle, dv[5] = Season, dv[6] = Current, dv[7] = Spin,
   *   dv[8] = Tide, dv[9] = Wave, dv[10] = GQ
   */
  let rem = bbS;
  const dv: number[] = [];
  for (let di = 10; di >= 0; di--) {
    dv.push(Math.floor(rem / DUR_SEC[di]));
    rem = rem % DUR_SEC[di];
  }

  const yr = at.getUTCFullYear();
  const doy = dayOfYear(at);
  const ud = utDate(doy, yr);

  const totalQ = (BB_SEC + epochSec) / DUR_SEC[0];
  const ceEpoch = Math.floor((epochSec - YEAR0_UNIX) / DUR_SEC[7]);

  /*
   * Orbit: a Tropical year. Defined in DUR_NAMES at index 6 between
   * Season (idx 5, 1e16/HF) and Epoch (idx 7, 1e18/HF). DUR_SEC[6]
   * follows from durExp[6]=17 so it is 1e17/HF, which equals 5
   * tropical years, not 1. The reference page treats the "Orbit"
   * label as the durExp[6] slot. We expose dv[4] as Cycle for parity
   * with the on-page dnCyc readout.
   */

  return {
    unix: epochSec,
    iso: at.toISOString(),
    utUnits: {
      eon: dv[0],
      age: dv[1],
      era: dv[2],
      epoch: dv[3],
      cycle: dv[4],
      season: dv[5],
      current: dv[6],
      spin: dv[7],
      tide: dv[8],
      wave: dv[9],
      gq: dv[10],
      orbit: dv[4],
    },
    solarUnits: { loop, arc, tick },
    calendar: {
      year: yr,
      month: ud.month,
      day: ud.day,
      dayOfYear: doy,
      daysInYear: daysInYear(yr),
      leap: isLeap(yr),
    },
    fractions: {
      dayFrac,
      loopFrac,
      arcFrac,
      tickFrac,
      waveFrac,
      tideFrac,
      currentFrac,
      seasonFrac,
      epochFrac,
    },
    bbQuants: totalQ.toExponential(6) + ' quants',
    ceEpoch,
  };
}

/*
 * Period in seconds for any unit name. Used to size the tick interval and
 * to detect transitions: the integer floor(now/period) advancing by 1 is
 * a transition.
 */
export function periodSec(unit: AnyUnitName): number {
  switch (unit) {
    case 'Tick':
      return 0.864;
    case 'Arc':
      return 86.4;
    case 'Loop':
      return 8640;
    case 'GQ':
      return DUR_SEC[0];
    case 'Wave':
      return DUR_SEC[1];
    case 'Tide':
      return DUR_SEC[2];
    case 'Spin':
      return DUR_SEC[3];
    case 'Current':
      return DUR_SEC[4];
    case 'Season':
      return DUR_SEC[5];
    case 'Orbit':
      return DUR_SEC[6];
    case 'Cycle':
      /*
       * The on-page Cycle dial reads dv[4]: floor(bbS / 1e17 * HF). That
       * matches DUR_EXP[6] which is also where Orbit lives. We treat
       * Cycle and Orbit as the same period for transition firing so the
       * reference page and the service agree.
       */
      return DUR_SEC[6];
    case 'Epoch':
      return DUR_SEC[7];
    case 'Era':
      return DUR_SEC[8];
    case 'Age':
      return DUR_SEC[9];
    case 'Eon':
      return DUR_SEC[10];
  }
}

/*
 * Integer counter for a unit: how many full periods have elapsed since the
 * Big Bang anchor (for duration units), or since the start of the UTC day
 * (for solar units). A subscription fires whenever this counter advances.
 */
export function unitCounter(unit: AnyUnitName, at: Date = new Date()): number {
  const epochSec = at.getTime() / 1000;
  if (unit === 'Tick' || unit === 'Arc' || unit === 'Loop') {
    const utcH = at.getUTCHours();
    const utcM = at.getUTCMinutes();
    const utcS = at.getUTCSeconds();
    const utcMs = at.getUTCMilliseconds();
    const daySec = utcH * 3600 + utcM * 60 + utcS + utcMs / 1000;
    if (unit === 'Tick') return Math.floor(daySec / 0.864);
    if (unit === 'Arc') return Math.floor(daySec / 86.4);
    return Math.floor(daySec / 8640);
  }
  const bbS = BB_SEC + epochSec;
  return Math.floor(bbS / periodSec(unit));
}

export function isValidUnit(name: string): name is AnyUnitName {
  return (ALL_UNITS as string[]).includes(name);
}
