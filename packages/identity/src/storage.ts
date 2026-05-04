/**
 * ════════════════════════════════════════════════════════════════════════════════
 *  @extropy/identity — In-memory storage
 * ════════════════════════════════════════════════════════════════════════════════
 *
 *  All identity state in v3.1 sandbox is in-memory and ephemeral. The reasons:
 *
 *    1. The canonical flow stores sensitive material (DID private keys, KYC
 *       attestations) ON THE PARTICIPANT'S DEVICE — not on the network. The
 *       service in this package only handles the network-facing artifacts
 *       (challenges, nullifiers, escrow packages without keys).
 *
 *    2. Stateless restart is part of the design. Anything important is
 *       reconstructible from the DAG (escrow receipts) or from holders re-
 *       presenting their proofs.
 *
 *  Production will add a Postgres-backed implementation of these interfaces.
 *  The interfaces below are deliberately minimal so swapping the backend is
 *  a one-file change.
 * ════════════════════════════════════════════════════════════════════════════════
 */

import { randomBytes } from 'node:crypto';
import { NullifierRegistry } from './nullifier.js';
import type { RevealPackage } from './escrow.js';

// ────────────────────────────────────────────────────────────────────────────
//  Onboarding session
// ────────────────────────────────────────────────────────────────────────────

export type OnboardingStage =
  | 'oauth-pending'
  | 'oauth-verified'
  | 'kyc-attested'
  | 'did-issued'
  | 'closed';

export interface OnboardingSession {
  sessionId: string;
  createdAt: string;
  updatedAt: string;
  stage: OnboardingStage;
  /** OAuth provider (e.g. "google"). */
  oauthProvider?: string;
  /** Hash of the OAuth subject identifier. We never persist the raw sub. */
  oauthSubjectDigest?: string;
  /** Hash of the on-device KYC attestation. */
  kycAttestationDigest?: string;
  /** Issued DID (after step 3). */
  did?: string;
}

// ────────────────────────────────────────────────────────────────────────────
//  Verifier challenge
// ────────────────────────────────────────────────────────────────────────────

export interface ChallengeRecord {
  challenge: string;
  contextTag: string;
  issuedAt: string;
  consumed: boolean;
}

// ────────────────────────────────────────────────────────────────────────────
//  Reveal request
// ────────────────────────────────────────────────────────────────────────────

export type RevealStage =
  | 'pending-shares'
  | 'shares-collected'
  | 'opened'
  | 'rejected';

export interface RevealRequest {
  revealId: string;
  /** DID being revealed. */
  targetDid: string;
  /** Hash of the governance proposal that authorized this reveal. */
  governanceProposalDigest: string;
  package: RevealPackage;
  /** How many shares have been collected so far. Stored as opaque counts only. */
  collectedShares: number;
  threshold: number;
  shareCount: number;
  stage: RevealStage;
  createdAt: string;
}

// ────────────────────────────────────────────────────────────────────────────
//  Store
// ────────────────────────────────────────────────────────────────────────────

export class IdentityStore {
  private onboarding = new Map<string, OnboardingSession>();
  private challenges = new Map<string, ChallengeRecord>();
  private reveals = new Map<string, RevealRequest>();
  public readonly nullifiers = new NullifierRegistry();

  // ── onboarding ──────────────────────────────────────────────────────────
  createOnboardingSession(input: Partial<OnboardingSession> = {}): OnboardingSession {
    const sessionId = randomId();
    const now = new Date().toISOString();
    const session: OnboardingSession = {
      sessionId,
      createdAt: now,
      updatedAt: now,
      stage: 'oauth-pending',
      ...input,
    };
    this.onboarding.set(sessionId, session);
    return session;
  }

  getOnboardingSession(sessionId: string): OnboardingSession | undefined {
    return this.onboarding.get(sessionId);
  }

  updateOnboardingSession(
    sessionId: string,
    patch: Partial<OnboardingSession>
  ): OnboardingSession | undefined {
    const existing = this.onboarding.get(sessionId);
    if (!existing) return undefined;
    const updated: OnboardingSession = {
      ...existing,
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    this.onboarding.set(sessionId, updated);
    return updated;
  }

  // ── challenges ──────────────────────────────────────────────────────────
  recordChallenge(challenge: string, contextTag: string): ChallengeRecord {
    const rec: ChallengeRecord = {
      challenge,
      contextTag,
      issuedAt: new Date().toISOString(),
      consumed: false,
    };
    this.challenges.set(challenge, rec);
    return rec;
  }

  consumeChallenge(challenge: string): ChallengeRecord | undefined {
    const rec = this.challenges.get(challenge);
    if (!rec || rec.consumed) return undefined;
    rec.consumed = true;
    return rec;
  }

  // ── reveals ─────────────────────────────────────────────────────────────
  recordRevealRequest(input: Omit<RevealRequest, 'revealId' | 'collectedShares' | 'stage' | 'createdAt'>): RevealRequest {
    const revealId = randomId();
    const rec: RevealRequest = {
      revealId,
      collectedShares: 0,
      stage: 'pending-shares',
      createdAt: new Date().toISOString(),
      ...input,
    };
    this.reveals.set(revealId, rec);
    return rec;
  }

  getRevealRequest(revealId: string): RevealRequest | undefined {
    return this.reveals.get(revealId);
  }

  incrementRevealShares(revealId: string): RevealRequest | undefined {
    const rec = this.reveals.get(revealId);
    if (!rec) return undefined;
    rec.collectedShares += 1;
    if (rec.collectedShares >= rec.threshold && rec.stage === 'pending-shares') {
      rec.stage = 'shares-collected';
    }
    return rec;
  }

  setRevealStage(revealId: string, stage: RevealStage): RevealRequest | undefined {
    const rec = this.reveals.get(revealId);
    if (!rec) return undefined;
    rec.stage = stage;
    return rec;
  }

  // ── stats ───────────────────────────────────────────────────────────────
  stats() {
    return {
      onboardingSessions: this.onboarding.size,
      activeChallenges: Array.from(this.challenges.values()).filter((c) => !c.consumed).length,
      consumedChallenges: Array.from(this.challenges.values()).filter((c) => c.consumed).length,
      revealRequests: this.reveals.size,
      nullifiers: this.nullifiers.size(),
    };
  }
}

function randomId(): string {
  return randomBytes(16).toString('hex');
}
