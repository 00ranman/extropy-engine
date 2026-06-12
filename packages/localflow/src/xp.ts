/**
 * LocalFlow XP formula implementation.
 *
 * Canonical formula from Extropy Engine v3.1.2:
 *   XP = R × F × ΔS × (w · E) × log(1 / Ts)
 *
 * Ts is the normalized settlement-time factor in (T_floor, 1.0].
 * Faster settlement means smaller Ts, which yields a larger log(1/Ts)
 * and therefore higher XP. Slower settlement yields lower XP.
 *
 * EP = XP × L  (local merchant loyalty multiplier)
 *
 * All five terms are multiplicative. Any zero term produces zero XP.
 */

import type { XpFormulaInputs, XpResult } from './types.js';

const TFLOOR = 0.01;

/**
 * Dot product of two equal-length vectors.
 */
function dot(a: number[], b: number[]): number {
  if (a.length !== b.length) throw new Error('Vector length mismatch');
  return a.reduce((sum, ai, i) => sum + ai * (b[i] ?? 0), 0);
}

/**
 * Compute XP from canonical five-term formula.
 * Returns 0 if any required term is non-positive.
 */
export function computeXP(inputs: XpFormulaInputs): number {
  const { R, F, deltaS, w, E, Ts } = inputs;

  if (R <= 0 || F <= 0 || deltaS <= 0) return 0;

  const wDotE = dot(w, E);
  if (wDotE <= 0) return 0;

  // Clamp Ts to floor (prevents log blow-up and grind attack via Ts -> 0).
  // Also cap at 1.0 since Ts is defined on (T_floor, 1.0].
  const tsClamped = Math.min(Math.max(Ts, TFLOOR), 1.0);
  const timeFactor = Math.log(1 / tsClamped);

  return R * F * deltaS * wDotE * timeFactor;
}

/**
 * Compute EP = XP × L (local multiplier).
 */
export function computeEP(xp: number, L: number): number {
  return xp * L;
}

/**
 * Full XP + EP result with default LocalFlow inputs for an errand/ride task.
 *
 * Default domain weight vector:
 *   [cognitive, code, social, economic, thermodynamic, informational, governance, temporal]
 * LocalFlow primarily reduces economic (idx 3) and temporal (idx 7) entropy.
 */
export function computeLocalflowLoop(
  overrides: Partial<XpFormulaInputs> & { deltaS: number; Ts: number },
  L = 1.2,
): XpResult {
  const defaults: XpFormulaInputs = {
    R: 0.8, // routine local errand, common but not trivial
    F: 1.0, // first occurrence full strength; caller should pass real F
    deltaS: overrides.deltaS,
    w: [0.05, 0, 0.1, 0.45, 0.05, 0.1, 0.05, 0.2], // economic + temporal heavy
    E: [0, 0, 0.1, 0.5, 0.05, 0.1, 0.05, 0.2],     // evidence matches weights
    Ts: overrides.Ts,
  };

  const inputs: XpFormulaInputs = { ...defaults, ...overrides };
  const xp = computeXP(inputs);
  const ep = computeEP(xp, L);

  return { xp, ep, inputs, L };
}
