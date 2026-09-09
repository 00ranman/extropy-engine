/**
 * @package xp-formula
 * Canonical meter math for the Extropy Engine.
 *
 * XP = R × F × ΔS × (w · E) × log(1/Tₛ)
 * XP(n) = XP_settled · 0.99ⁿ
 *
 * L  = clip(H_cap · S · κ · CT_W · β, 0, 1)
 * EP = XP · L + λ · L     clipped to the list price
 *
 * CT_W is the community meter. Same readout at every compatible till.
 * H_cap is this till this pocket. Auto from signed cash. Training pocket remainder is 0.
 * S is this person at this house.
 * β is proofs shown this ticket (CAT / on-duty). Not a CT wrap.
 * IT = clip(H_gov · S_gov · κ · CT_W · β_gov, 0, 1)
 * Weight this proposal. Burns in the tally. No pile.
 * Not XP · G — that is an XP oligarchy.
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
  /** This till this pocket. Auto from signed cash. 0 during training. */
  H_cap?: number;
  /** Alias for H_cap when S is omitted. */
  H?: number;
  /** This person at this house. Default 1 if omitted. */
  S?: number;
  /** Community standing on web W. Same at every compatible door. */
  CT: number;
  /** Compatibility with web W. 1 base. 0 if they left the language. Default 1. */
  kappa?: number;
  /** Proofs this ticket: CAT, on-duty bit. Default 1. Off the clock, drop it. */
  beta?: number;
  /** Floor coefficient so thin XP cannot zero a real L. Default 0.15. */
  lambda?: number;
  /** Clip spark to the sticker. */
  listPrice?: number;
}

export interface TillSparkResult {
  L: number;
  EP: number;
  burned: true;
}

export interface VoteSparkResult {
  IT: number;
  burned: true;
}

export interface GovStandingInputs {
  /** How hard standing counts this vote. 0 = one DID one nullifier. Default 1. */
  H_gov?: number;
  /** You in this room. 0 if you are not in it. Default 1 if omitted. */
  S_gov?: number;
  CT: number;
  kappa?: number;
  /** Lane / on-duty / not-a-party-to-the-dispute. Default 1. */
  beta_gov?: number;
}

export const DEFAULT_DELTA_T_CAP_SECONDS = 5 * 60;
/** Two 5-day weeks. Leak tick. n in 0.99ⁿ is idle two-week counts. No third named unit. */
export const LEAK_DAYS = 10;
/** Till books. Eight weeks. Auto H and training. Not the leak tick. */
export const H_WINDOW_DAYS = 40;
/** @deprecated Use LEAK_DAYS for leak, H_WINDOW_DAYS for the till. */
export const SPAN_DAYS = LEAK_DAYS;
export const POCKET_DAYS = H_WINDOW_DAYS;
/** Keep per idle two weeks. 0.99ⁿ. Half-life ≈ 1.9 years. */
export const POCKET_KEEP = 0.99;
export const XP_MONTHLY_KEEP = POCKET_KEEP;
/** CT idle leak. Same keep as XP. n = idle two-week counts on web W. */
export const CT_MONTHLY_KEEP = POCKET_KEEP;
export const DEFAULT_H_GOV = 1;
/** Small XP-equivalent. EP = XP·L + λ·L. Web W may republish with eight-week notice. */
export const DEFAULT_EP_FLOOR = 0.15;
/** Healthy-books remainder scale. After training, Auto sits here when in ≈ out. Not a till control. */
export const DEFAULT_H_CAP = 0.5;
export const DEFAULT_S = 1;
export const S_TEETH_DAYS = 14;
export const LAMBDA_NOTICE_DAYS = H_WINDOW_DAYS;
export const BETA_ALLOWLIST_NOTICE_DAYS = 14;

/**
 * Trailing eight-week cash → H_cap. No till slider. No Off button.
 * trainedDays < H_WINDOW_DAYS → 0. Training. Remainder sleeps. Feature.
 * After that: clip(0.5 × cash_in / cash_out, 0, 1). Healthy books sit at 0.5.
 * Real Off is: don't run the node.
 */
export function hCapFromCash(cashIn: number, cashOut: number, trainedDays = H_WINDOW_DAYS): number {
  if (trainedDays < H_WINDOW_DAYS) return 0;
  const out = Math.max(cashOut, 1e-9);
  const ratio = Math.max(0, cashIn) / out;
  return clip01(DEFAULT_H_CAP * ratio);
}

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

/** L = clip(H_cap · S · κ · CT_W · β, 0, 1) */
export function computeL(inputs: LocalStandingInputs): number {
  const Hcap = clip01(inputs.H_cap ?? inputs.H ?? DEFAULT_H_CAP);
  const S = clip01(inputs.S ?? DEFAULT_S);
  const kappa = inputs.kappa ?? 1;
  const beta = inputs.beta ?? 1;
  return clip01(Hcap * S * kappa * inputs.CT * beta);
}

/** EP = XP · L + λ · L. Thin XP cannot erase a real local L. */
export function computeEP(xp: number, L: number, lambda = DEFAULT_EP_FLOOR): number {
  const L0 = clip01(L);
  if (L0 <= 0) return 0;
  return Math.max(0, xp) * L0 + Math.max(0, lambda) * L0;
}

export function sparkTill(xp: number, standing: LocalStandingInputs): TillSparkResult {
  const L = computeL(standing);
  let EP = computeEP(xp, L, standing.lambda ?? DEFAULT_EP_FLOOR);
  if (standing.listPrice != null && Number.isFinite(standing.listPrice)) {
    EP = Math.min(Math.max(0, standing.listPrice), EP);
  }
  return { L, EP, burned: true };
}

export function leakXP(xpSettled: number, n: number): number {
  if (xpSettled <= 0 || n <= 0) return Math.max(0, xpSettled);
  return xpSettled * Math.pow(POCKET_KEEP, n);
}

export function leakCT(ctSettled: number, n: number): number {
  if (ctSettled <= 0 || n <= 0) return Math.max(0, ctSettled);
  return ctSettled * Math.pow(POCKET_KEEP, n);
}

/** IT = clip(H_gov · S_gov · κ · CT_W · β_gov, 0, 1). This proposal. Not XP. */
export function computeIT(inputs: GovStandingInputs): number {
  const Hgov = clip01(inputs.H_gov ?? DEFAULT_H_GOV);
  const Sgov = clip01(inputs.S_gov ?? DEFAULT_S);
  const kappa = inputs.kappa ?? 1;
  const beta = inputs.beta_gov ?? 1;
  return clip01(Hgov * Sgov * kappa * inputs.CT * beta);
}

export function sparkVote(inputs: GovStandingInputs): VoteSparkResult {
  return { IT: computeIT(inputs), burned: true };
}
