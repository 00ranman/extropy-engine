/**
 * ════════════════════════════════════════════════════════════════════════════════
 *  EXTROPY ENGINE — Event Bus Contract
 * ════════════════════════════════════════════════════════════════════════════════
 *
 *  Defines all typed domain events that flow between microservices.
 *  Services publish events; consumers subscribe by event type.
 *
 *  Event naming convention: <aggregate>.<verb>
 *  Examples: loop.opened, loop.closed, claim.verified, xp.minted
 *
 * ════════════════════════════════════════════════════════════════════════════════
 */

import type {
  LoopId, ClaimId, SubClaimId, ValidatorId, MintEventId,
  EntropyDomain, LoopStatus, ClaimStatus, SubClaimStatus,
  EntropyMeasurement, LoopConsensus, BayesianPrior,
  ValidationResult, XPDistribution, MintStatus,
  DomainEvent,
} from './types';

// ─────────────────────────────────────────────────────────────────────────────
//  Loop Events (published by Loop Ledger)
// ─────────────────────────────────────────────────────────────────────────────

export interface LoopOpenedPayload {
  loopId: LoopId;
  claimId: ClaimId;
  domain: EntropyDomain;
  submitterId: ValidatorId;
}
export type LoopOpenedEvent = DomainEvent<LoopOpenedPayload>;

export interface LoopClosedPayload {
  loopId: LoopId;
  deltaS: number;
  consensus: LoopConsensus;
  settlementTimeSeconds: number;
}
export type LoopClosedEvent = DomainEvent<LoopClosedPayload>;

export interface LoopFailedPayload {
  loopId: LoopId;
  reason: string;
  deltaS: number | null;
}
export type LoopFailedEvent = DomainEvent<LoopFailedPayload>;

export interface LoopSettledPayload {
  loopId: LoopId;
  mintEventId: MintEventId;
  totalXpMinted: number;
  distribution: XPDistribution[];
}
export type LoopSettledEvent = DomainEvent<LoopSettledPayload>;

// ─────────────────────────────────────────────────────────────────────────────
//  Claim Events (published by Epistemology Engine)
// ─────────────────────────────────────────────────────────────────────────────

export interface ClaimSubmittedPayload {
  claimId: ClaimId;
  loopId: LoopId;
  domain: EntropyDomain;
  statement: string;
}
export type ClaimSubmittedEvent = DomainEvent<ClaimSubmittedPayload>;

export interface ClaimDecomposedPayload {
  claimId: ClaimId;
  loopId: LoopId;
  subClaimIds: SubClaimId[];
  estimatedValidationTimeSeconds: number;
}
export type ClaimDecomposedEvent = DomainEvent<ClaimDecomposedPayload>;

export interface ClaimVerifiedPayload {
  claimId: ClaimId;
  loopId: LoopId;
  truthScore: number;
  bayesianPrior: BayesianPrior;
}
export type ClaimVerifiedEvent = DomainEvent<ClaimVerifiedPayload>;

export interface ClaimFalsifiedPayload {
  claimId: ClaimId;
  loopId: LoopId;
  truthScore: number;
  reason: string;
}
export type ClaimFalsifiedEvent = DomainEvent<ClaimFalsifiedPayload>;

// ─────────────────────────────────────────────────────────────────────────────
//  Sub-Claim Events (published by Epistemology Engine)
// ─────────────────────────────────────────────────────────────────────────────

export interface SubClaimAssignedPayload {
  subClaimId: SubClaimId;
  claimId: ClaimId;
  loopId: LoopId;
  assignedValidatorId: ValidatorId;
  domain: EntropyDomain;
}
export type SubClaimAssignedEvent = DomainEvent<SubClaimAssignedPayload>;

export interface SubClaimResolvedPayload {
  subClaimId: SubClaimId;
  claimId: ClaimId;
  loopId: LoopId;
  status: SubClaimStatus;
  result: ValidationResult;
}
export type SubClaimResolvedEvent = DomainEvent<SubClaimResolvedPayload>;

// ─────────────────────────────────────────────────────────────────────────────
//  XP Events (published by XP Mint Service)
// ─────────────────────────────────────────────────────────────────────────────

export interface XPMintedPayload {
  mintEventId: MintEventId;
  loopId: LoopId;
  xpValue: number;
  status: MintStatus;
  distribution: XPDistribution[];
}
export type XPMintedEvent = DomainEvent<XPMintedPayload>;

export interface XPBurnedPayload {
  mintEventId: MintEventId;
  loopId: LoopId;
  xpValue: number;
  burnReason: string;
}
export type XPBurnedEvent = DomainEvent<XPBurnedPayload>;

// ─────────────────────────────────────────────────────────────────────────────
//  Event Type Registry
// ─────────────────────────────────────────────────────────────────────────────

export const EVENT_TYPES = {
  // Loop
  LOOP_OPENED:    'loop.opened',
  LOOP_CLOSED:    'loop.closed',
  LOOP_FAILED:    'loop.failed',
  LOOP_SETTLED:   'loop.settled',
  // Claim
  CLAIM_SUBMITTED:  'claim.submitted',
  CLAIM_DECOMPOSED: 'claim.decomposed',
  CLAIM_VERIFIED:   'claim.verified',
  CLAIM_FALSIFIED:  'claim.falsified',
  // SubClaim
  SUBCLAIM_ASSIGNED: 'subclaim.assigned',
  SUBCLAIM_RESOLVED: 'subclaim.resolved',
  // XP
  XP_MINTED: 'xp.minted',
  XP_BURNED: 'xp.burned',
} as const;

export type EventType = typeof EVENT_TYPES[keyof typeof EVENT_TYPES];
