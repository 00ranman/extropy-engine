/**
 * @package xp-formula
 * Canonical XP formula implementation for the Extropy Engine.
 *
 * XP = R × F × ΔS × (w · E) × log(1/Tₛ)
 *
 * Where:
 *   R  = Rarity multiplier (action-class scarcity / base difficulty).
 *        Property of the loop's action class — NOT actor reputation.
 *        Reputation belongs in vote weight (V+/V-) and CT (ρ), not here.
 *   F  = Frequency-of-decay penalty (diminishing returns for repeated
 *        instances of this action class). 1.0 = first occurrence.
 *   ΔS = Entropy delta (verified disorder reduction score, must be > 0)
 *   w  = Weight vector for energy components
 *   E  = Energy vector (effort dimensions: cognitive, physical, temporal)
 *   Tₛ = Timestamp decay factor (recency, 0 < Tₛ ≤ 1)
 *
 * Both xp-mint and xp-dag-mesh MUST import from this package.
 * Do NOT reimplement the formula elsewhere.
 */

export interface XPFormulaInputs {
  /** Rarity/difficulty multiplier. Typically 1.0–3.0 */
  R: number;
  /** Frequency decay factor. 1.0 = first occurrence, <1 = repeated */
  F: number;
  /** Verified entropy reduction delta. Must be > 0 to mint. */
  deltaS: number;
  /** Weight vector for each energy dimension */
  w: number[];
  /** Energy vector (same length as w) */
  E: number[];
  /** Timestamp decay factor. 0 < Ts <= 1. Computed as exp(-λΔt). */
  Ts: number;
}

export interface XPFormulaResult {
  xp: number;
  breakdown: {
    R: number;
    F: number;
    deltaS: number;
    wDotE: number;
    logDecay: number;
  };
  valid: boolean;
  reason?: string;
}

/**
 * Compute XP according to the canonical Extropy formula.
 * Returns xp=0 with valid=false if preconditions are not met.
 */
export function computeXP(inputs: XPFormulaInputs): XPFormulaResult {
  const { R, F, deltaS, w, E, Ts } = inputs;

  // Precondition: entropy reduction must be positive
  if (deltaS <= 0) {
    return { xp: 0, breakdown: { R, F, deltaS, wDotE: 0, logDecay: 0 }, valid: false, reason: 'deltaS must be > 0' };
  }
  if (Ts <= 0 || Ts > 1) {
    return { xp: 0, breakdown: { R, F, deltaS, wDotE: 0, logDecay: 0 }, valid: false, reason: 'Ts must be in (0, 1]' };
  }
  if (w.length !== E.length) {
    return { xp: 0, breakdown: { R, F, deltaS, wDotE: 0, logDecay: 0 }, valid: false, reason: 'w and E must have equal length' };
  }

  const wDotE = w.reduce((sum, wi, i) => sum + wi * E[i], 0);
  const logDecay = Math.log(1 / Ts);
  const xp = R * F * deltaS * wDotE * logDecay;

  return {
    xp: Math.max(0, xp),
    breakdown: { R, F, deltaS, wDotE, logDecay },
    valid: true,
  };
}

/**
 * Compute the timestamp decay factor given elapsed time and decay rate.
 * @param deltaT - elapsed seconds since the triggering event
 * @param lambda - decay constant (default 0.001 = slow decay)
 */
export function computeTimestampDecay(deltaT: number, lambda = 0.001): number {
  return Math.exp(-lambda * deltaT);
}

/**
 * Convenience: compute XP from raw elapsed time instead of pre-computed Ts.
 */
export function computeXPWithDecay(
  inputs: Omit<XPFormulaInputs, 'Ts'>,
  deltaT: number,
  lambda = 0.001
): XPFormulaResult {
  const Ts = computeTimestampDecay(deltaT, lambda);
  return computeXP({ ...inputs, Ts });
}
