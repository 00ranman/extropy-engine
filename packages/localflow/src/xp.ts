/**
 * LocalFlow XP + EP computation.
 *
 * The canonical XP formula lives in @extropy/xp-formula and is the single
 * source of truth. LocalFlow does NOT reimplement it. This module only:
 *   1. delegates XP computation to the canonical package, and
 *   2. applies the LocalFlow-specific EP = XP x L merchant loyalty multiplier.
 *
 * XP is non-transferable and non-extractive; EP is the local merchant loyalty
 * layer and does not feed back into XP.
 */

import { computeXP, FORMULA_VERSION } from '@extropy/xp-formula';
import type { XPFormulaInputs, XPFormulaResult } from '@extropy/xp-formula';
import type { NormalizedMeasurement, XpResult } from './types.js';

export { FORMULA_VERSION } from '@extropy/xp-formula';

/**
 * Compute XP from canonical inputs by delegating to @extropy/xp-formula.
 * Returns the full canonical result (including validity and breakdown).
 */
export function computeLocalflowXP(inputs: XPFormulaInputs): XPFormulaResult {
  return computeXP(inputs);
}

/**
 * Compute EP = XP x L (local merchant loyalty multiplier).
 */
export function computeEP(xp: number, L: number): number {
  return xp * L;
}

/**
 * Settle a LocalFlow loop from a validated, normalized measurement.
 *
 * Requires an explicitly normalized measurement. LocalFlow does not synthesize
 * the canonical inputs; they must already be normalized upstream. Returns null
 * when the canonical formula rejects the inputs, so a caller can keep the loop
 * pending rather than mint invalid XP.
 */
export function settleFromNormalized(
  measurement: NormalizedMeasurement,
  L = 1.2,
): XpResult | null {
  const result = computeLocalflowXP(measurement.inputs);
  if (!result.valid) return null;

  return {
    xp: result.xp,
    ep: computeEP(result.xp, L),
    inputs: measurement.inputs,
    L,
    formulaVersion: FORMULA_VERSION,
  };
}
