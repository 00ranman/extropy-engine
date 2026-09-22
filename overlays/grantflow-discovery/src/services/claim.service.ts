/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  GrantFlow Discovery — Claim Service
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *  Generates and submits Extropy Engine claims for each GrantFlow action.
 *  Each claim opens a Loop in the Loop Ledger → verified ΔS → XP minting.
 *
 *  Claim types and their entropy domains:
 *
 *  | Claim Type             | Domain        | ΔS Description                         |
 *  |------------------------|---------------|----------------------------------------|
 *  | grant.discovered       | INFORMATIONAL | Filtering noise → relevant signal      |
 *  | grant.matched          | INFORMATIONAL | Profile-aligned grant identified       |
 *  | submission.prepared    | ECONOMIC      | Structured S2S package ready           |
 *  | submission.submitted   | ECONOMIC      | Application sent to granting agency    |
 *
 *  Flow for each claim:
 *    1. POST to EPISTEMOLOGY_URL/api/v1/claims
 *    2. Store local GfClaimRecord (loopId links back to verification loop)
 *    3. When LOOP_CLOSED event arrives with matching loopId → XP minted
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { v4 as uuid } from 'uuid';
import { EventType } from '@extropy/contracts';
import type { DomainEvent } from '@extropy/contracts';
import type { DatabaseService } from './database.service.js';
import type { EventBusService } from './event-bus.service.js';
import type {
  GfOpportunity,
  GfMatch,
  GfSubmission,
  GfClaimRecord,
  GfClaimStatus,
  GfClaimType,
} from '../types/index.js';

/** Base ΔS values for each claim type (in information entropy units) */
const DELTA_S_MAP: Record<GfClaimType, number> = {
  'grant.discovered':      0.42,  // Information entropy reduction from filtering ~1000 grants → 1 relevant
  'grant.matched':         0.28,  // Additional entropy reduction from profile alignment
  'submission.prepared':   0.65,  // Economic entropy reduction: undefined application → structured package
  'submission.submitted':  1.20,  // Major economic event: application now in external review
};

/** Extropy Engine entropy domains for each claim type */
const DOMAIN_MAP: Record<GfClaimType, string> = {
  'grant.discovered':      'informational',
  'grant.matched':         'informational',
  'submission.prepared':   'economic',
  'submission.submitted':  'economic',
};

export class ClaimService {
  constructor(
    private readonly db: DatabaseService,
    private readonly eventBus: EventBusService,
    private readonly config: {
      epistemologyUrl: string;
      loopLedgerUrl: string;
      validatorId: string;
    },
  ) {}

  // ─────────────────────────────────────────────────────────────────────────
  //  Claim Emission
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Emit a claim for discovering a new grant opportunity.
   * Entropy reduction: mass of raw grants → filtered relevant signal.
   *
   * @param opportunity - The discovered opportunity
   * @returns Created GfClaimRecord
   */
  async emitDiscoveryClaim(opportunity: GfOpportunity): Promise<GfClaimRecord> {
    const statement = `Discovered relevant grant opportunity: "${opportunity.title}" from ${opportunity.agency}`;

    return this.emitClaim({
      claimType:     'grant.discovered',
      statement,
      evidence:      {
        opportunityId:  opportunity.id,
        oppNumber:      opportunity.oppNumber,
        title:          opportunity.title,
        agency:         opportunity.agency,
        closeDate:      opportunity.closeDate,
        awardCeiling:   opportunity.awardCeiling,
      },
      opportunityId: opportunity.id,
    });
  }

  /**
   * Emit a claim for matching a grant to a researcher profile.
   * Entropy reduction: vague search space → precise match candidate.
   *
   * @param match - The computed GfMatch
   * @returns Created GfClaimRecord
   */
  async emitMatchClaim(match: GfMatch): Promise<GfClaimRecord> {
    const statement = `Matched grant ${match.opportunityId} to research profile ${match.profileId} with score ${match.score.toFixed(1)}/100`;

    return this.emitClaim({
      claimType:     'grant.matched',
      statement,
      evidence:      {
        matchId:       match.id,
        opportunityId: match.opportunityId,
        profileId:     match.profileId,
        score:         match.score,
        matchReasons:  match.matchReasons,
        keywordMatches: match.keywordMatches,
        domainMatches: match.domainMatches,
      },
      opportunityId: match.opportunityId,
      profileId:     match.profileId,
    });
  }

  /**
   * Emit a claim for preparing an S2S submission package.
   * Entropy reduction: unstructured application → validated XML package.
   *
   * @param submission - The submission with prepared package
   * @returns Created GfClaimRecord
   */
  async emitSubmissionPreparedClaim(submission: GfSubmission): Promise<GfClaimRecord> {
    const statement = `Prepared S2S submission package for grant application ${submission.id} (opportunity ${submission.opportunityId})`;

    return this.emitClaim({
      claimType:     'submission.prepared',
      statement,
      evidence:      {
        submissionId:  submission.id,
        opportunityId: submission.opportunityId,
        profileId:     submission.profileId,
        proposalId:    submission.proposalId,
        packageReady:  Boolean(submission.s2sPackageXml),
      },
      opportunityId: submission.opportunityId,
      profileId:     submission.profileId,
      submissionId:  submission.id,
    });
  }

  /**
   * Emit a claim for submitting an application to Grants.gov via S2S.
   * Entropy reduction: prepared package → active external review.
   *
   * @param submission - The submitted submission with tracking number
   * @returns Created GfClaimRecord
   */
  async emitSubmissionClaim(submission: GfSubmission): Promise<GfClaimRecord> {
    const statement = `Submitted grant application to Grants.gov via S2S — tracking: ${submission.grantsGovTrackingNumber ?? 'pending'}`;

    return this.emitClaim({
      claimType:     'submission.submitted',
      statement,
      evidence:      {
        submissionId:            submission.id,
        opportunityId:           submission.opportunityId,
        profileId:               submission.profileId,
        grantsGovTrackingNumber: submission.grantsGovTrackingNumber,
        submittedAt:             submission.submittedAt,
      },
      opportunityId: submission.opportunityId,
      profileId:     submission.profileId,
      submissionId:  submission.id,
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  Loop Closure Handler
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Handle a LOOP_CLOSED event from the event bus.
   * If the closed loop belongs to one of our claims, update its status.
   *
   * @param event - The LOOP_CLOSED domain event
   */
  async handleLoopClosed(event: DomainEvent): Promise<void> {
    const payload = event.payload as Record<string, unknown>;
    const loopId  = event.correlationId;
    const deltaS  = payload.deltaS as number ?? 0;

    const { rows } = await this.db.query(
      'SELECT * FROM gf_claim_records WHERE loop_id = $1',
      [loopId],
    );

    if (rows.length === 0) return; // Not our loop

    const record = rows[0];
    console.log(
      `[claims] Loop ${loopId} closed with ΔS=${deltaS} — updating claim ${record['claim_id']}`,
    );

    await this.updateClaimStatus(record['id'] as string, 'verified');
  }

  /**
   * Handle an XP_MINTED_PROVISIONAL event.
   * Records the minted XP value against the appropriate claim record.
   *
   * @param event - The XP_MINTED_PROVISIONAL domain event
   */
  async handleXpMinted(event: DomainEvent): Promise<void> {
    const payload  = event.payload as Record<string, unknown>;
    const mintEvent = payload.mintEvent as Record<string, unknown> | undefined;
    if (!mintEvent) return;

    const loopId   = mintEvent.loopId as string;
    const xpValue  = mintEvent.xpValue as number;

    const { rows } = await this.db.query(
      'SELECT * FROM gf_claim_records WHERE loop_id = $1',
      [loopId],
    );

    if (rows.length === 0) return;

    const claimRecordId = rows[0]['id'] as string;
    await this.updateClaimStatus(claimRecordId, 'xp_minted', xpValue);

    console.log(
      `[claims] XP minted for loop ${loopId}: ${xpValue} XP`,
    );
  }

  /**
   * Update the status of a claim record.
   *
   * @param id       - Internal GfClaimRecord UUID
   * @param status   - New status
   * @param xpMinted - XP amount if status is 'xp_minted'
   */
  async updateClaimStatus(
    id: string,
    status: GfClaimStatus,
    xpMinted?: number,
  ): Promise<void> {
    await this.db.query(
      `UPDATE gf_claim_records
       SET status = $2, xp_minted = COALESCE($3, xp_minted), updated_at = NOW()
       WHERE id = $1`,
      [id, status, xpMinted ?? null],
    );
  }

  /**
   * Get all claim records for an opportunity.
   */
  async getClaimsForOpportunity(opportunityId: string): Promise<GfClaimRecord[]> {
    const { rows } = await this.db.query(
      'SELECT * FROM gf_claim_records WHERE opportunity_id = $1 ORDER BY created_at DESC',
      [opportunityId],
    );
    return rows.map(r => this.rowToClaimRecord(r));
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  Private Helpers
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Core claim emission method.
   * 1. Generates a loop ID
   * 2. Posts the claim to the Epistemology Engine
   * 3. Emits a CLAIM_SUBMITTED event on the event bus
   * 4. Records the claim locally
   */
  private async emitClaim(params: {
    claimType:     GfClaimType;
    statement:     string;
    evidence:      Record<string, unknown>;
    opportunityId?: string;
    profileId?:     string;
    submissionId?:  string;
  }): Promise<GfClaimRecord> {
    const loopId  = uuid();
    const claimId = uuid();
    const domain  = DOMAIN_MAP[params.claimType];
    const deltaS  = DELTA_S_MAP[params.claimType];
    const now     = new Date().toISOString();

    // ── Submit to Epistemology Engine ───────────────────────────────────
    let epistemologyClaimId = claimId;
    try {
      const res = await fetch(
        `${this.config.epistemologyUrl}/api/v1/claims`,
        {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({
            id:          claimId,
            loopId,
            statement:   params.statement,
            evidence:    params.evidence,
            domain,
            deltaS,
            validatorId: this.config.validatorId,
            source:      'grantflow-discovery',
            timestamp:   now,
          }),
        },
      );

      if (!res.ok) {
        const text = await res.text();
        console.warn(
          `[claims] Epistemology Engine returned ${res.status}: ${text.slice(0, 200)}`,
        );
      } else {
        const body = await res.json() as Record<string, unknown>;
        epistemologyClaimId = (body.claimId ?? body.id ?? claimId) as string;
      }
    } catch (err) {
      console.warn(
        `[claims] Could not reach Epistemology Engine: ${(err as Error).message}`,
      );
    }

    // ── Emit CLAIM_SUBMITTED event on the bus ───────────────────────────
    try {
      await this.eventBus.emit(
        EventType.CLAIM_SUBMITTED as EventType,
        loopId,
        {
          claimId:    epistemologyClaimId,
          statement:  params.statement,
          domain,
          deltaS,
          evidence:   params.evidence,
          source:     'grantflow-discovery',
          validatorId: this.config.validatorId,
        } as unknown as Parameters<typeof this.eventBus.emit>[2],
      );
    } catch (err) {
      console.warn(
        `[claims] Failed to emit CLAIM_SUBMITTED event: ${(err as Error).message}`,
      );
    }

    // ── Persist claim record ─────────────────────────────────────────────
    const recordId = uuid();

    await this.db.query(
      `INSERT INTO gf_claim_records (
        id, claim_id, loop_id, claim_type, status,
        opportunity_id, profile_id, submission_id,
        created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        recordId,
        epistemologyClaimId,
        loopId,
        params.claimType,
        'submitted',
        params.opportunityId ?? null,
        params.profileId ?? null,
        params.submissionId ?? null,
        now,
        now,
      ],
    );

    console.log(
      `[claims] Claim emitted — type=${params.claimType} loop=${loopId} claim=${epistemologyClaimId}`,
    );

    return {
      id:            recordId,
      claimId:       epistemologyClaimId,
      loopId,
      claimType:     params.claimType,
      status:        'submitted',
      opportunityId: params.opportunityId,
      profileId:     params.profileId,
      submissionId:  params.submissionId,
      createdAt:     now,
      updatedAt:     now,
    };
  }

  private rowToClaimRecord(row: Record<string, unknown>): GfClaimRecord {
    return {
      id:            row['id'] as string,
      claimId:       row['claim_id'] as string,
      loopId:        row['loop_id'] as string,
      claimType:     row['claim_type'] as GfClaimType,
      status:        row['status'] as GfClaimStatus,
      opportunityId: row['opportunity_id'] as string | undefined,
      profileId:     row['profile_id'] as string | undefined,
      submissionId:  row['submission_id'] as string | undefined,
      xpMinted:      row['xp_minted'] != null ? Number(row['xp_minted']) : undefined,
      createdAt:     (row['created_at'] as Date).toISOString(),
      updatedAt:     (row['updated_at'] as Date).toISOString(),
    };
  }
}
