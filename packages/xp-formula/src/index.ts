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
 *   w  = Weight vector for energy / domain components
 *   E  = Effort / domain vector (same length as w)
 *   Tₛ = Slam window, NOT recency decay and NOT the 0.99ⁿ standing leak.
 *        Tₛ = exp(−λ min(Δt, Δt_cap)). Instant confirm → Tₛ = 1 → log = 0 → XP = 0.
 *        That is slam-shut, on purpose. Do not rewrite as log(1+1/Tₛ).
 *
 * Three clocks. Do not mash them:
 *   1. Tₛ  — this loop's elapsed time (capped)
 *   2. F   — repeating the action class
 *   3. 0.99ⁿ — standing leak after settlement (not in this package)
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
  /** Weight vector for each energy / domain dimension */
  w: number[];
  /** Energy / domain vector (same length as w) */
  E: number[];
  /** Slam window. 0 < Ts <= 1. Computed as exp(-λ min(Δt, Δt_cap)). */
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

/** Quest-grain default: 5 minutes. Action class may pass a longer expected duration. */
export const DEFAULT_DELTA_T_CAP_SECONDS = 5 * 60;

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
 * Slam-window factor. Instant confirm (deltaT → 0) returns 1, so log(1/Ts) = 0.
 * deltaT is clipped to deltaTCap so stalling past the class duration does not print.
 */
export function computeTimestampDecay(
  deltaT: number,
  lambda = 0.001,
  deltaTCap = DEFAULT_DELTA_T_CAP_SECONDS
): number {
  const dt = Math.max(0, Math.min(deltaT, deltaTCap));
  return Math.exp(-lambda * dt);
}

/**
 * Convenience: compute XP from raw elapsed time instead of pre-computed Ts.
 * Pass expectedDurationSec from the action class when it is longer than the quest grain.
 */
export function computeXPWithDecay(
  inputs: Omit<XPFormulaInputs, 'Ts'>,
  deltaT: number,
  lambda = 0.001,
  deltaTCap = DEFAULT_DELTA_T_CAP_SECONDS
): XPFormulaResult {
  const Ts = computeTimestampDecay(deltaT, lambda, deltaTCap);
  return computeXP({ ...inputs, Ts });
}
