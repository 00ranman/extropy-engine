/**
 * @package xp-formula
 * Canonical meter math for the Extropy Engine.
 *
 * XP = R × F × ΔS × (w · E) × log(1/Tₛ)
 *
 *   R  = Rarity of the action class. Not reputation. Not a room.
 *   F  = Frequency of Decay on repeats. Not fidelity. Not ℱ.
 *   ΔS = bits-equivalent proxy for verified reduction inside a declared
 *        boundary. Not XP. Not SI social heat.
 *   w · E = weighted emergence (eight-domain weights · this loop's effort).
 *   Tₛ = slam window: exp(−λ min(Δt, Δt_cap)). Instant close → XP = 0.
 *
 * After the mint:
 *   XP(n) = XP_settled · 0.99ⁿ
 *   L     = clip(H · CT_d · β, 0, 1)
 *   EP    = XP × L   born and burned in that sale. Not a bag.
 *
 * CT is this-door standing. It does not transfer. It does not cash out.
 * CAT and IT stay off this package.
 */

export interface XPFormulaInputs {
  /** Rarity of the action class. Typically 0.1–10. Not reputation. */
  R: number;
  /** Frequency of Decay. 1.0 = first occurrence in class. */
  F: number;
  /** Bits-equivalent proxy. Must be > 0 to mint. */
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

export interface LocalStandingInputs {
  /** House slider on this till. 0 parks the overlay. */
  H: number;
  /** This-door standing. Not XP. Not Sam's Club at the laundromat. */
  CT: number;
  /** Optional door-local band (ZKP / mapper). Default 1. */
  beta?: number;
}

export interface TillSparkResult {
  L: number;
  EP: number;
  burned: true;
}

/** Quest-grain default: 5 minutes. Action class may pass a longer expected duration. */
export const DEFAULT_DELTA_T_CAP_SECONDS = 5 * 60;

export const XP_MONTHLY_KEEP = 0.99;

/**
 * Compute XP according to the canonical Extropy formula.
 * Returns xp=0 with valid=false if preconditions are not met.
 */
export function computeXP(inputs: XPFormulaInputs): XPFormulaResult {
  const { R, F, deltaS, w, E, Ts } = inputs;

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

export function computeXPWithDecay(
  inputs: Omit<XPFormulaInputs, 'Ts'>,
  deltaT: number,
  lambda = 0.001,
  deltaTCap = DEFAULT_DELTA_T_CAP_SECONDS
): XPFormulaResult {
  const Ts = computeTimestampDecay(deltaT, lambda, deltaTCap);
  return computeXP({ ...inputs, Ts });
}

export function clip01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

/** L on this ticket. House owns H. CT is this door only. */
export function computeL(inputs: LocalStandingInputs): number {
  const beta = inputs.beta ?? 1;
  return clip01(inputs.H * inputs.CT * beta);
}

/** Till spark. Does not persist. Caller must burn it in the sale. */
export function computeEP(xp: number, L: number): number {
  if (xp <= 0 || L <= 0) return 0;
  return xp * clip01(L);
}

export function sparkTill(xp: number, standing: LocalStandingInputs): TillSparkResult {
  const L = computeL(standing);
  return { L, EP: computeEP(xp, L), burned: true };
}

/** Standing leak. n is months (or epochs of that length). */
export function leakXP(xpSettled: number, n: number): number {
  if (xpSettled <= 0 || n <= 0) return Math.max(0, xpSettled);
  return xpSettled * Math.pow(XP_MONTHLY_KEEP, n);
}
