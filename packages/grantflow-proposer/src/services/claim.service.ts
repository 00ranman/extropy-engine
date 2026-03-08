/**
 * ════════════════════════════════════════════════════════════════════════════════
 *  GrantFlow Proposer — Claim Service
 * ════════════════════════════════════════════════════════════════════════════════
 *
 *  Generates Extropy Engine claims for proposal-related entropy reduction events.
 *  Each claim represents a verifiable reduction in cognitive or informational
 *  entropy, submitted to the Epistemology Engine and tracked through Loop lifecycle.
 *
 *  Claim types and domains:
 *    - Draft claim:      "Drafted proposal for {grantTitle}"     → COGNITIVE
 *    - Refinement claim: "Refined {section} for {grantTitle}"    → COGNITIVE
 *    - Section claim:    "Completed {sectionType} for {grant}"   → INFORMATIONAL
 *    - Export claim:     "Exported proposal for {grantTitle}"    → INFORMATIONAL
 *
 *  Each claim call:
 *    1. Constructs a claim payload with domain, statement, and ΔS estimate
 *    2. POSTs to the Epistemology Engine's /api/v1/claims endpoint
 *    3. Records the claim_id and loop_id locally in gf_claims
 *    4. Emits CLAIM_SUBMITTED event on the event bus
 *    5. Registers a webhook back to this service for LOOP_CLOSED events
 *
 * ════════════════════════════════════════════════════════════════════════════════
 */

import { v4 as uuid } from 'uuid';
import { EventType, EntropyDomain } from '@extropy/contracts';
import type { LoopId } from '@extropy/contracts';
import type { DatabaseService } from './database.service.js';
import type { EventBusService } from './event-bus.service.js';
import type {
  GfProposal,
  GfSection,
  GfRefinement,
} from '../types/index.js';

// ─────────────────────────────────────────────────────────────────────────────
//  Types
// ─────────────────────────────────────────────────────────────────────────────

interface ClaimRecord {
  claim_id:    string;
  loop_id:     string;
  proposal_id: string;
  claim_type:  string;
  statement:   string;
  domain:      string;
  status:      string;
  xp_value:    number | null;
  created_at:  Date;
}

interface EpistemologyClaimResponse {
  claimId: string;
  loopId:  string;
  status:  string;
}

// ─────────────────────────────────────────────────────────────────────────────
//  ClaimService
// ─────────────────────────────────────────────────────────────────────────────

export class ClaimService {
  /**
   * @param db               - Database service for local claim records
   * @param eventBus         - Event bus for emitting claim events
   * @param epistemologyUrl  - URL of the Epistemology Engine
   * @param loopLedgerUrl    - URL of the Loop Ledger
   */
  constructor(
    private readonly db: DatabaseService,
    private readonly eventBus: EventBusService,
    private readonly epistemologyUrl: string,
    private readonly loopLedgerUrl: string,
  ) {}

  // ── Table Initialization ───────────────────────────────────────────────────

  /**
   * Ensure the local gf_claims table exists.
   * Called once at service startup.
   */
  async initTable(): Promise<void> {
    await this.db.query(`
      CREATE TABLE IF NOT EXISTS gf_claims (
        id          BIGSERIAL PRIMARY KEY,
        claim_id    TEXT NOT NULL UNIQUE,
        loop_id     TEXT NOT NULL,
        proposal_id TEXT NOT NULL,
        claim_type  TEXT NOT NULL,
        statement   TEXT NOT NULL,
        domain      TEXT NOT NULL,
        status      TEXT NOT NULL DEFAULT 'submitted',
        xp_value    NUMERIC(10, 4),
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await this.db.query(`
      CREATE INDEX IF NOT EXISTS idx_gf_claims_proposal_id ON gf_claims(proposal_id)
    `);

    await this.db.query(`
      CREATE INDEX IF NOT EXISTS idx_gf_claims_loop_id ON gf_claims(loop_id)
    `);
  }

  // ── Internal Claim Submission ──────────────────────────────────────────────

  /**
   * Submit a claim to the Epistemology Engine.
   * Falls back to local-only recording if the engine is unreachable.
   *
   * @param statement  - Human-readable claim statement
   * @param domain     - Entropy domain (COGNITIVE or INFORMATIONAL)
   * @param proposalId - The proposal this claim pertains to
   * @param claimType  - Type tag for local record keeping
   * @param deltaS     - Estimated entropy reduction (0.0001–1.0)
   * @param validatorId - The agent/user making the claim
   */
  private async submitClaim(
    statement: string,
    domain: EntropyDomain,
    proposalId: string,
    claimType: string,
    deltaS: number,
    validatorId: string,
  ): Promise<{ claimId: string; loopId: string }> {
    const correlationId = uuid() as LoopId;
    let claimId = uuid();
    let loopId  = correlationId;

    // Attempt to submit to Epistemology Engine
    try {
      const response = await fetch(`${this.epistemologyUrl}/api/v1/claims`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          statement,
          domain,
          submitterId: validatorId,
          correlationId,
          metadata: {
            service:    'grantflow-proposer',
            proposalId,
            claimType,
            deltaS,
          },
        }),
        signal: AbortSignal.timeout(8_000),
      });

      if (response.ok) {
        const data = await response.json() as EpistemologyClaimResponse;
        claimId = data.claimId ?? claimId;
        loopId  = data.loopId  ?? loopId;
        console.log(`[proposer:claim] Submitted to Epistemology: claimId=${claimId}, loopId=${loopId}`);
      } else {
        console.warn(`[proposer:claim] Epistemology Engine returned ${response.status} — recording locally`);
      }
    } catch (err) {
      console.warn(`[proposer:claim] Epistemology Engine unreachable — recording locally:`, (err as Error).message);
    }

    // Record locally
    await this.db.query(
      `INSERT INTO gf_claims
         (claim_id, loop_id, proposal_id, claim_type, statement, domain, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'submitted')
       ON CONFLICT (claim_id) DO NOTHING`,
      [claimId, loopId, proposalId, claimType, statement, domain],
    );

    // Emit claim event on the bus
    await this.eventBus.emit(
      EventType.CLAIM_SUBMITTED,
      loopId as LoopId,
      {
        claim: {
          id:          claimId as unknown,
          loopId:      loopId as LoopId,
          statement,
          domain,
          submitterId: validatorId as unknown,
          status:      'submitted' as unknown,
          bayesianPrior: {
            priorProbability: 0.7,
            likelihood: 0.8,
            counterLikelihood: 0.2,
            posteriorProbability: 0.93,
            updateCount: 0,
            confidenceInterval: [0.6, 0.99] as [number, number],
            updateHistory: [],
          },
          subClaimIds: [],
          truthScore: 0.7,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      } as unknown as import('@extropy/contracts').EventPayloadMap[typeof EventType.CLAIM_SUBMITTED],
    );

    return { claimId, loopId };
  }

  // ── Public Claim Emitters ──────────────────────────────────────────────────

  /**
   * Emit a draft claim when a new proposal is created.
   * Domain: COGNITIVE — reduces cognitive entropy by converting a vague idea
   * into a structured proposal draft.
   *
   * @param proposal    - The newly created proposal
   * @param validatorId - The validator/agent who drafted the proposal
   */
  async emitDraftClaim(
    proposal: GfProposal,
    validatorId: string,
  ): Promise<{ claimId: string; loopId: string }> {
    const statement = `Drafted proposal for "${proposal.opportunityTitle}" (${proposal.agency})`;
    console.log(`[proposer:claim] Emitting draft claim: ${statement}`);

    return this.submitClaim(
      statement,
      EntropyDomain.COGNITIVE,
      proposal.id,
      'proposal_drafted',
      0.3, // ΔS: substantial cognitive entropy reduction from vague idea to structured document
      validatorId,
    );
  }

  /**
   * Emit a refinement claim when a section is refined.
   * Domain: COGNITIVE — each refinement pass reduces cognitive entropy further.
   *
   * @param proposal    - The parent proposal
   * @param refinement  - The completed refinement record
   * @param validatorId - The validator/agent who performed the refinement
   */
  async emitRefinementClaim(
    proposal: GfProposal,
    refinement: GfRefinement,
    validatorId: string,
  ): Promise<{ claimId: string; loopId: string }> {
    const sectionLabel = refinement.sectionId.slice(0, 8);
    const statement    = `Refined section ${sectionLabel} for "${proposal.opportunityTitle}" — ΔQ=${refinement.qualityDelta > 0 ? '+' : ''}${refinement.qualityDelta.toFixed(1)}`;
    console.log(`[proposer:claim] Emitting refinement claim: ${statement}`);

    // ΔS scales with quality improvement — better refinements earn more
    const deltaS = Math.max(0.01, Math.min(0.5, refinement.qualityDelta / 100));

    return this.submitClaim(
      statement,
      EntropyDomain.COGNITIVE,
      proposal.id,
      'section_refined',
      deltaS,
      validatorId,
    );
  }

  /**
   * Emit a section completion claim when a section is generated or completed.
   * Domain: INFORMATIONAL — converting unstructured requirements into a
   * structured, documented section reduces informational entropy.
   *
   * @param proposal    - The parent proposal
   * @param section     - The completed section
   * @param validatorId - The validator/agent who completed the section
   */
  async emitSectionClaim(
    proposal: GfProposal,
    section: GfSection,
    validatorId: string,
  ): Promise<{ claimId: string; loopId: string }> {
    const sectionLabel = section.sectionType.replace(/_/g, ' ').toLowerCase();
    const statement    = `Completed ${sectionLabel} for "${proposal.opportunityTitle}"`;
    console.log(`[proposer:claim] Emitting section claim: ${statement}`);

    return this.submitClaim(
      statement,
      EntropyDomain.INFORMATIONAL,
      proposal.id,
      'section_completed',
      0.15, // ΔS: each section completion reduces informational entropy
      validatorId,
    );
  }

  /**
   * Emit an export claim when a proposal is exported for submission.
   * Domain: INFORMATIONAL — exporting converts the internal proposal into
   * a formatted submission-ready document, reducing informational entropy.
   *
   * @param proposal    - The exported proposal
   * @param validatorId - The validator/agent who triggered the export
   */
  async emitExportClaim(
    proposal: GfProposal,
    validatorId: string,
  ): Promise<{ claimId: string; loopId: string }> {
    const statement = `Exported proposal for "${proposal.opportunityTitle}" (${proposal.agency}) — Quality: ${proposal.qualityScore.toFixed(1)}/100`;
    console.log(`[proposer:claim] Emitting export claim: ${statement}`);

    return this.submitClaim(
      statement,
      EntropyDomain.INFORMATIONAL,
      proposal.id,
      'proposal_exported',
      0.2, // ΔS: export represents final packaging for submission
      validatorId,
    );
  }

  // ── Claim Status Management ────────────────────────────────────────────────

  /**
   * Update the status of a locally recorded claim.
   * Called when LOOP_CLOSED or XP_MINTED_PROVISIONAL events are received.
   *
   * @param claimId - The claim UUID
   * @param status  - New status ('verified', 'falsified', 'xp_minted', etc.)
   * @param xpValue - XP earned if status is 'xp_minted'
   */
  async updateClaimStatus(
    claimId: string,
    status: string,
    xpValue?: number,
  ): Promise<void> {
    await this.db.query(
      `UPDATE gf_claims
       SET status = $1${xpValue !== undefined ? ', xp_value = $3' : ''}
       WHERE claim_id = $2`,
      xpValue !== undefined
        ? [status, claimId, xpValue]
        : [status, claimId],
    );
  }

  /**
   * Handle a task assignment event from SignalFlow.
   * If the task is routed to grantflow-proposer, process the validation.
   *
   * @param taskId       - The task ID
   * @param claimId      - The claim to validate
   * @param correlationId - Loop correlation ID
   * @param source       - Source service name
   * @param domain       - Entropy domain
   */
  async handleValidationTask(
    taskId: string,
    claimId: string,
    correlationId: string,
    source: string,
    domain: string,
  ): Promise<void> {
    console.log(`[proposer:claim] Handling validation task ${taskId} for claim ${claimId} (domain=${domain})`);

    // Look up the claim locally
    const { rows } = await this.db.query<ClaimRecord>(
      'SELECT * FROM gf_claims WHERE claim_id = $1',
      [claimId],
    );

    if (rows.length === 0) {
      console.warn(`[proposer:claim] No local claim found for ${claimId}`);
      return;
    }

    const claim = rows[0];

    // For COGNITIVE domain claims, validate by checking proposal quality score
    if (claim.domain === EntropyDomain.COGNITIVE || claim.domain === EntropyDomain.INFORMATIONAL) {
      const { rows: proposals } = await this.db.query<{ quality_score: string }>(
        'SELECT quality_score FROM gf_proposals WHERE id = $1',
        [claim.proposal_id],
      );

      if (proposals.length > 0) {
        const quality = parseFloat(proposals[0].quality_score);
        // Confirm if quality > 20 (minimal viable proposal content)
        const verdict = quality > 20 ? 'confirmed' : 'denied';

        try {
          await fetch(`${this.epistemologyUrl}/api/v1/tasks/${taskId}/complete`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({
              verdict,
              confidence: Math.min(0.95, quality / 100 + 0.2),
              justification: `Proposal quality score: ${quality.toFixed(1)}/100. ` +
                `Claim "${claim.statement}" ${verdict === 'confirmed' ? 'validated' : 'could not be validated'}.`,
              evidenceMeasurementIds: [],
              validationDurationSeconds: 1,
            }),
            signal: AbortSignal.timeout(5_000),
          });
        } catch (err) {
          console.warn(`[proposer:claim] Failed to submit validation result:`, (err as Error).message);
        }
      }
    }
  }

  // ── Query ──────────────────────────────────────────────────────────────────

  /**
   * Get all claims for a proposal.
   *
   * @param proposalId - The proposal UUID
   */
  async getClaimsForProposal(proposalId: string): Promise<ClaimRecord[]> {
    const { rows } = await this.db.query<ClaimRecord>(
      'SELECT * FROM gf_claims WHERE proposal_id = $1 ORDER BY created_at DESC',
      [proposalId],
    );
    return rows;
  }

  /**
   * Look up a claim by its loop ID.
   * Used when LOOP_CLOSED events arrive to identify which proposal to update.
   *
   * @param loopId - The loop UUID
   */
  async getClaimByLoopId(loopId: string): Promise<ClaimRecord | null> {
    const { rows } = await this.db.query<ClaimRecord>(
      'SELECT * FROM gf_claims WHERE loop_id = $1 LIMIT 1',
      [loopId],
    );
    return rows.length > 0 ? rows[0] : null;
  }
}
