/**
 * Meter-first ledger objects (SPEC v3.5).
 * L is this-ticket math — not a transferable bag.
 * EP and IT are sparks that burn — not wallet piles.
 * CAT is a record off the mint that feeds β.
 */

export type Did = string;
export type WebId = string;
export type LaneId = string;

/** Community meter on web W. Same readout at compatible tills. */
export interface CTMeter {
  webId: WebId;
  did: Did;
  /** Settled CT_W standing */
  value: number;
  updatedAt: string;
}

/** Skill credential — unique per (DID, lane). Off the mint. Feeds β. */
export interface CATRecord {
  did: Did;
  lane: LaneId;
  level: number;
  issuer: Did;
  issuedAt: string;
  revokedAt?: string | null;
}

/** Inputs for this-ticket L (see computeL in xp-formula). */
export interface LTicketInputs {
  H_cap: number;
  S: number;
  kappa: number;
  CT: number;
  /** CAT / on-duty / signed if-then this ticket. Default 1 if door asked for nothing. */
  beta: number;
}

/** Till spark result — must not be stored as a spendable balance. */
export interface EPSpark {
  kind: 'EP';
  xp: number;
  L: number;
  EP: number;
  burned: true;
}

/** Vote spark result — burns in the tally. */
export interface ITSpark {
  kind: 'IT';
  IT: number;
  burned: true;
}

export const METER_OBJECTS = ['XP', 'CT', 'L', 'EP', 'CAT', 'IT'] as const;
export type MeterObject = (typeof METER_OBJECTS)[number];

/** Dead letter — do not mint. */
export const DT_IS_NOT_A_BAG =
  'DT is not a bag. Expertise is CAT-per-lane. Leak is already on XP.';
