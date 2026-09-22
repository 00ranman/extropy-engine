/**
 * LocalFlow does not own mint math. Kernel is @extropy/xp-formula via SignalFlow.
 */

import {
  computeXP as kernelXP,
  computeEP as kernelEP,
  sparkTill,
  type XPFormulaInputs,
} from '@extropy/xp-formula';
import type { XpFormulaInputs, XpResult } from './types.js';

export function computeXP(inputs: XpFormulaInputs): number {
  const r = kernelXP({
    R: inputs.R,
    F: inputs.F,
    deltaS: inputs.deltaS,
    w: inputs.w,
    E: inputs.E,
    Ts: inputs.Ts,
  });
  return r.valid ? r.xp : 0;
}

export function computeEP(xp: number, L: number): number {
  return kernelEP(xp, L);
}

export function computeLocalflowLoop(
  overrides: Partial<XpFormulaInputs> & { deltaS: number; Ts: number },
  L = 1,
): XpResult {
  const defaults: XpFormulaInputs = {
    R: 0.8,
    F: 1.0,
    deltaS: overrides.deltaS,
    w: [0.05, 0, 0.1, 0.45, 0.05, 0.1, 0.05, 0.2],
    E: [0, 0, 0.1, 0.5, 0.05, 0.1, 0.05, 0.2],
    Ts: overrides.Ts,
  };
  const inputs: XpFormulaInputs = { ...defaults, ...overrides };
  const xp = computeXP(inputs);
  const spark = sparkTill(xp, { CT: 1, H_cap: Math.min(1, L), S: 1 });
  return { xp, ep: spark.EP, inputs, L: spark.L };
}

export type { XPFormulaInputs };
