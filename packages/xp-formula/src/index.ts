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
 *   Tₛ = Normalized settlement-time factor. Unitless. In (T_FLOOR, 1].
 *        NOT raw seconds. Codex v3.1.2 §20.2 constraint: "T_s must be
 *        normalized; raw seconds is not accepted. The log term is capped
 *        at log(1/T_floor)."
 *
 * Both xp-mint and xp-dag-mesh MUST import from this package.
 * Do NOT reimplement the formula elsewhere.
 *
 * Canonical formula version: canonical-v3.1.3 (T_s floor patch).
 * Change vs v3.1.2: Ts is now enforced normalized-and-bounded at the
 * formula boundary; log term is clamped to [0, log(1/T_FLOOR)]; a new
 * helper `normalizeSettlementTime` converts raw seconds to the required
 * unitless factor using a per-domain causal closure speed. Prior code
 * paths that fed raw seconds directly into log(1/·) were both:
 *   (a) unbounded as raw seconds → 0 (speed-farming), AND
 *   (b) silently returning zero XP for any raw seconds > 1 (because
 *       log(1/x) < 0 there and the mint guard clamped to 0).
 * The v3.1.3 patch closes both.
 */

export const FORMULA_VERSION = 'canonical-v3.1.3' as const;

/**
 * Default T_s floor. Governance-tunable per Codex GOVERNANCE_DEFAULTS.
 * Codex §20.1 lists T_floor default as 0.01, giving a hard cap of
 * log(1/0.01) ≈ 4.605 on the settlement-time factor. That cap is what
 * prevents the speed-farming attack on the settlement-time term.
 */
export const T_FLOOR_DEFAULT = 0.01;

/** Hard upper bound on the log term derived from T_FLOOR_DEFAULT. */
export const LOG_DECAY_CAP_DEFAULT = Math.log(1 / T_FLOOR_DEFAULT);

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
  /**
   * Normalized settlement-time factor. Unitless.
   * MUST be in (0, 1]. Values ≤ T_floor are clamped to T_floor.
   * To go from raw elapsed seconds to Tₛ, use `normalizeSettlementTime`.
   */
  Ts: number;
  /**
   * Optional governance override for the settlement-time floor.
   * If omitted, uses T_FLOOR_DEFAULT (0.01).
   */
  Tfloor?: number;
}

export interface XPFormulaResult {
  xp: number;
  breakdown: {
    R: number;
    F: number;
    deltaS: number;
    wDotE: number;
    logDecay: number;
    /** The effective T_floor used for this calculation. */
    Tfloor: number;
    /** True if Ts was clamped up to Tfloor (speed-farming attempt). */
    tsClamped: boolean;
  };
  valid: boolean;
  reason?: string;
  formulaVersion: typeof FORMULA_VERSION;
}

/**
 * Compute XP according to the canonical Extropy formula (v3.1.3).
 *
 * Bounds guaranteed by construction:
 *   - logDecay ∈ [0, log(1/Tfloor)]  (no divergence, no negative)
 *   - xp ≥ 0                          (never mints negative)
 *   - xp bounded for any positive input tuple
 *
 * Returns xp=0 with valid=false if preconditions are not met.
 */
export function computeXP(inputs: XPFormulaInputs): XPFormulaResult {
  const { R, F, deltaS, w, E, Ts } = inputs;
  const Tfloor = inputs.Tfloor ?? T_FLOOR_DEFAULT;

  const zeroBreakdown = {
    R, F, deltaS, wDotE: 0, logDecay: 0, Tfloor, tsClamped: false,
  };

  // Preconditions
  if (!Number.isFinite(R) || R <= 0) {
    return { xp: 0, breakdown: zeroBreakdown, valid: false, reason: 'R must be > 0', formulaVersion: FORMULA_VERSION };
  }
  if (!Number.isFinite(F) || F <= 0 || F > 1) {
    return { xp: 0, breakdown: zeroBreakdown, valid: false, reason: 'F must be in (0, 1]', formulaVersion: FORMULA_VERSION };
  }
  if (!Number.isFinite(deltaS) || deltaS <= 0) {
    return { xp: 0, breakdown: zeroBreakdown, valid: false, reason: 'deltaS must be > 0', formulaVersion: FORMULA_VERSION };
  }
  if (!Number.isFinite(Ts) || Ts <= 0 || Ts > 1) {
    return { xp: 0, breakdown: zeroBreakdown, valid: false, reason: 'Ts must be in (0, 1] and finite', formulaVersion: FORMULA_VERSION };
  }
  if (!Number.isFinite(Tfloor) || Tfloor <= 0 || Tfloor >= 1) {
    return { xp: 0, breakdown: zeroBreakdown, valid: false, reason: 'Tfloor must be in (0, 1)', formulaVersion: FORMULA_VERSION };
  }
  if (w.length !== E.length || w.length === 0) {
    return { xp: 0, breakdown: zeroBreakdown, valid: false, reason: 'w and E must be same non-zero length', formulaVersion: FORMULA_VERSION };
  }

  // Clamp Ts to floor — this is the anti-speed-farming invariant.
  const tsClamped = Ts < Tfloor;
  const TsEffective = Math.max(Ts, Tfloor);

  const wDotE = w.reduce((sum, wi, i) => sum + wi * E[i], 0);
  if (wDotE <= 0) {
    return { xp: 0, breakdown: { ...zeroBreakdown, wDotE }, valid: false, reason: 'w·E must be > 0', formulaVersion: FORMULA_VERSION };
  }

  const logCap = Math.log(1 / Tfloor);
  const logDecay = Math.min(Math.log(1 / TsEffective), logCap);
  // Post-clamp logDecay is guaranteed ≥ 0 because TsEffective ≤ 1.

  const xp = R * F * deltaS * wDotE * logDecay;

  return {
    xp: Math.max(0, xp),
    breakdown: { R, F, deltaS, wDotE, logDecay, Tfloor, tsClamped },
    valid: true,
    formulaVersion: FORMULA_VERSION,
  };
}

/**
 * Convert raw elapsed seconds into the normalized settlement-time factor
 * Tₛ ∈ (T_floor, 1] required by the canonical formula.
 *
 * The mapping is Tₛ = exp(-λ · Δt) where λ is the per-domain settlement
 * decay constant. This makes the log term linear in Δt:
 *     log(1/Tₛ) = λ · Δt
 * which is the intended semantics of "faster settlement is more valuable,
 * with diminishing returns via the log", without ever producing raw-seconds
 * pathologies.
 *
 * λ is calibrated per domain from the causal closure speed (see Codex §20.1
 * on c_l). A reasonable seed default is λ = 1e-4 (slow decay; a 1-day
 * settlement gives log-decay ≈ 8.64, which then clamps to the T_floor cap).
 */
export function normalizeSettlementTime(
  elapsedSeconds: number,
  lambda: number = 1e-4,
  Tfloor: number = T_FLOOR_DEFAULT,
): number {
  if (!Number.isFinite(elapsedSeconds) || elapsedSeconds < 0) return Tfloor;
  if (!Number.isFinite(lambda) || lambda <= 0) return 1.0;
  const raw = Math.exp(-lambda * elapsedSeconds);
  // Clamp into (Tfloor, 1].
  if (raw >= 1) return 1;
  if (raw <= Tfloor) return Tfloor;
  return raw;
}

/**
 * Convenience: compute XP directly from raw elapsed seconds, hiding the
 * normalization step. Prefer this over building `Ts` by hand.
 */
export function computeXPFromElapsedSeconds(
  inputs: Omit<XPFormulaInputs, 'Ts'>,
  elapsedSeconds: number,
  lambda: number = 1e-4,
): XPFormulaResult {
  const Tfloor = inputs.Tfloor ?? T_FLOOR_DEFAULT;
  const Ts = normalizeSettlementTime(elapsedSeconds, lambda, Tfloor);
  return computeXP({ ...inputs, Ts });
}

/**
 * @deprecated Use `normalizeSettlementTime` (per-domain lambda) instead.
 * Retained for backward compatibility with pre-v3.1.3 callers.
 */
export function computeTimestampDecay(deltaT: number, lambda = 0.001): number {
  return Math.exp(-lambda * deltaT);
}

/**
 * @deprecated Use `computeXPFromElapsedSeconds` instead. This wrapper
 * uses the historical default lambda=0.001, which is retained only for
 * call-site compatibility. New code MUST pass an explicit per-domain lambda.
 */
export function computeXPWithDecay(
  inputs: Omit<XPFormulaInputs, 'Ts'>,
  deltaT: number,
  lambda = 0.001,
): XPFormulaResult {
  const Ts = normalizeSettlementTime(deltaT, lambda, inputs.Tfloor ?? T_FLOOR_DEFAULT);
  return computeXP({ ...inputs, Ts });
}
