/**
 * ════════════════════════════════════════════════════════════════════════════════
 *  EXTROPY ENGINE — Academia Bridge | ClaimService
 * ════════════════════════════════════════════════════════════════════════════════
 *
 *  Generates and submits entropy claims to the Epistemology Engine.
 *
 *  Three claim types:
 *
 *  1. `emitQueueClaim` — paper queued for upload (INFORMATIONAL domain)
 *     ΔS = small, represents the intention/organizational entropy reduction
 *
 *  2. `emitUploadClaim` — paper published to academia.edu (INFORMATIONAL + SOCIAL)
 *     This is the high-value event: private knowledge → public knowledge.
 *     ΔS = log2(potential_audience) − log2(1)
 *     A paper visible to ~10,000 researchers ≈ log2(10,000) ≈ 13.29 bits
 *
 *  3. `emitViewMilestoneClaim` — paper reaches N views (SOCIAL domain)
 *     ΔS = proportional to engagement milestone
 *
 *  Each claim is POSTed to the Epistemology Engine's /api/v1/claims endpoint.
 *  The Epistemology Engine opens a Loop in the Loop Ledger, measures ΔS,
 *  and mints XP when the loop closes with ΔS > 0.
 *
 * ════════════════════════════════════════════════════════════════════════════════
 */

import { v4 as uuid } from 'uuid';
import { EventType, EntropyDomain } from '@extropy/contracts';
import type { DatabaseService } from './database.service.js';
import type { EventBusService } from './event-bus.service.js';
import type { AbPaper, AbUpload } from '../types/index.js';

/** Estimated potential audience on academia.edu (conservative) */
const ESTIMATED_AUDIENCE = 10_000;

/** ΔS for uploading: log2(potential_audience) bits of entropy reduction */
const UPLOAD_DELTA_S = Math.log2(ESTIMATED_AUDIENCE); // ≈ 13.29 bits

/** ΔS for queuing: small, represents intent/organization entropy reduction */
const QUEUE_DELTA_S = 0.5;

// ─────────────────────────────────────────────────────────────────────────────
//  ClaimService
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generates Extropy Engine entropy claims and submits them to the Epistemology Engine.
 *
 * All claims flow through POST EPISTEMOLOGY_URL/api/v1/claims.
 * Events are also published on the EventBus so the Loop Ledger and XP Mint
 * can react independently.
 */
export class ClaimService {
  private readonly epistemologyUrl: string;

  constructor(
    private readonly db: DatabaseService,
    private readonly eventBus: EventBusService,
    epistemologyUrl: string,
  ) {
    this.epistemologyUrl = epistemologyUrl;
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  Public API
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Emit a claim for queuing a paper.
   * Small entropy reduction — represents intent and organizational state change.
   *
   * Domain: INFORMATIONAL
   * ΔS: 0.5 bits (task organization entropy reduction)
   *
   * @param paper - The newly queued AbPaper
   */
  async emitQueueClaim(paper: AbPaper): Promise<void> {
    const claimText = `Queued paper: "${paper.title}" for academia.edu upload`;
    const correlationId = uuid();

    console.log(`[academia-bridge] Emitting queue claim for paper ${paper.id}`);

    await this._submitClaim({
      id:            uuid(),
      correlationId,
      text:          claimText,
      source:        'academia-bridge',
      domains:       [EntropyDomain.INFORMATIONAL],
      deltaS:        QUEUE_DELTA_S,
      metadata: {
        paperId:          paper.id,
        paperTitle:       paper.title,
        fileType:         paper.fileType,
        sourceProposalId: paper.sourceProposalId,
        event:            'paper.queued',
      },
    });

    // Emit EventBus event
    await this.eventBus.emit(
      EventType.CLAIM_SUBMITTED,
      correlationId,
      {
        claimText,
        domain:   EntropyDomain.INFORMATIONAL,
        deltaS:   QUEUE_DELTA_S,
        paperId:  paper.id,
        source:   'academia-bridge',
      },
    );
  }

  /**
   * Emit a claim for successfully publishing a paper to academia.edu.
   * This is the high-value event: private knowledge becomes public.
   *
   * Domain: INFORMATIONAL + SOCIAL
   * ΔS: log2(10,000) ≈ 13.29 bits
   *   — Information went from 1 person (private) to potentially thousands of
   *     researchers (public). The entropy reduction is the log of the audience size.
   *
   * @param paper  - The uploaded AbPaper
   * @param upload - The completed AbUpload record
   */
  async emitUploadClaim(paper: AbPaper, upload: AbUpload): Promise<void> {
    if (!upload.academiaUrl) {
      console.warn(`[academia-bridge] Cannot emit upload claim: no academiaUrl for upload ${upload.id}`);
      return;
    }

    const claimText = `Published "${paper.title}" to academia.edu`;
    const correlationId = uuid();

    console.log(`[academia-bridge] Emitting upload claim for paper ${paper.id}: ΔS=${UPLOAD_DELTA_S.toFixed(4)}`);

    await this._submitClaim({
      id:            uuid(),
      correlationId,
      text:          claimText,
      source:        'academia-bridge',
      domains:       [EntropyDomain.INFORMATIONAL, EntropyDomain.SOCIAL],
      deltaS:        UPLOAD_DELTA_S,
      metadata: {
        paperId:         paper.id,
        paperTitle:      paper.title,
        uploadId:        upload.id,
        academiaUrl:     upload.academiaUrl,
        estimatedAudience: ESTIMATED_AUDIENCE,
        deltaSExplanation: `log2(${ESTIMATED_AUDIENCE}) = ${UPLOAD_DELTA_S.toFixed(4)} bits — private knowledge → public knowledge`,
        sourceProposalId: paper.sourceProposalId,
        event:           'paper.uploaded',
      },
    });

    // Emit EventBus event for Loop Ledger
    await this.eventBus.emit(
      EventType.CLAIM_SUBMITTED,
      correlationId,
      {
        claimText,
        domains:    [EntropyDomain.INFORMATIONAL, EntropyDomain.SOCIAL],
        deltaS:     UPLOAD_DELTA_S,
        paperId:    paper.id,
        uploadId:   upload.id,
        academiaUrl: upload.academiaUrl,
        source:     'academia-bridge',
      },
    );
  }

  /**
   * Emit a claim for a paper reaching a view milestone.
   * Represents external validation — real humans reading and engaging with the work.
   *
   * Domain: SOCIAL
   * ΔS: log2(views / previous_milestone) — incremental social entropy reduction
   *
   * @param paper - The AbPaper that reached the milestone
   * @param views - Total view count that triggered the milestone
   */
  async emitViewMilestoneClaim(paper: AbPaper, views: number): Promise<void> {
    if (!paper.academiaUrl) {
      console.warn(`[academia-bridge] Cannot emit milestone claim: no academiaUrl for paper ${paper.id}`);
      return;
    }

    // ΔS proportional to log2(views) — more views = more social proof = more entropy reduction
    const deltaS = Math.max(0.1, Math.log2(Math.max(1, views)));
    const claimText = `Paper "${paper.title}" reached ${views.toLocaleString()} views on academia.edu`;
    const correlationId = uuid();

    console.log(`[academia-bridge] Emitting view milestone claim for paper ${paper.id}: ${views} views, ΔS=${deltaS.toFixed(4)}`);

    await this._submitClaim({
      id:            uuid(),
      correlationId,
      text:          claimText,
      source:        'academia-bridge',
      domains:       [EntropyDomain.SOCIAL],
      deltaS,
      metadata: {
        paperId:     paper.id,
        paperTitle:  paper.title,
        academiaUrl: paper.academiaUrl,
        views,
        deltaSExplanation: `log2(${views}) = ${deltaS.toFixed(4)} bits — social validation milestone`,
        event:       'paper.viewed',
      },
    });

    // Emit EventBus event
    await this.eventBus.emit(
      EventType.CLAIM_SUBMITTED,
      correlationId,
      {
        claimText,
        domain:      EntropyDomain.SOCIAL,
        deltaS,
        paperId:     paper.id,
        academiaUrl: paper.academiaUrl,
        views,
        source:      'academia-bridge',
      },
    );
  }

  /**
   * Handle a validation task assigned by SignalFlow.
   * Called when EventType.TASK_ASSIGNED targets academia-bridge or informational/social domain.
   *
   * @param taskId        - The task UUID
   * @param claimId       - The claim to validate
   * @param correlationId - Loop ID
   * @param sourceService - Service that routed the task
   * @param domain        - Entropy domain of the claim
   */
  async handleValidationTask(
    taskId: string,
    claimId: string,
    correlationId: string,
    sourceService: string,
    domain: string,
  ): Promise<void> {
    console.log(`[academia-bridge] Handling validation task ${taskId} for claim ${claimId} (domain: ${domain})`);

    // Look up the claim in our local context (by correlationId)
    const { rows } = await this.db.query(
      `SELECT p.id, p.title, p.academia_url, p.status
       FROM academia.ab_papers p
       WHERE p.id = $1 OR p.source_proposal_id = $1`,
      [claimId],
    );

    if (rows.length > 0) {
      const paper = rows[0] as Record<string, unknown>;
      // A claim about a paper we uploaded is verifiable by checking academia.edu
      const isUploaded = paper.status === 'uploaded' && paper.academia_url;

      await this.eventBus.emit(
        EventType.TASK_COMPLETED,
        correlationId,
        {
          taskId,
          claimId,
          validated:   isUploaded,
          validatorId: 'academia-bridge',
          domain,
          evidence:    isUploaded ? { academiaUrl: paper.academia_url, paperId: paper.id } : null,
          source:      'academia-bridge',
        },
      );
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  Private — Epistemology Engine submission
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Submit an entropy claim to the Epistemology Engine via HTTP POST.
   * Logs but does not throw on network errors — claim submission is
   * fire-and-forget from the service's perspective.
   */
  private async _submitClaim(claim: {
    id: string;
    correlationId: string;
    text: string;
    source: string;
    domains: EntropyDomain[];
    deltaS: number;
    metadata: Record<string, unknown>;
  }): Promise<void> {
    const url = `${this.epistemologyUrl}/api/v1/claims`;

    const body = {
      id:            claim.id,
      correlationId: claim.correlationId,
      text:          claim.text,
      source:        claim.source,
      domains:       claim.domains,
      deltaS:        claim.deltaS,
      metadata:      claim.metadata,
      timestamp:     new Date().toISOString(),
    };

    try {
      const resp = await fetch(url, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      });

      if (!resp.ok) {
        const text = await resp.text();
        console.error(`[academia-bridge] Claim submission failed (${resp.status}): ${text}`);
      } else {
        console.log(`[academia-bridge] Claim submitted: ${claim.id} — "${claim.text}"`);
      }
    } catch (err) {
      console.error(`[academia-bridge] Claim submission error (network):`, err);
      // Non-fatal — the event bus still notifies downstream services
    }
  }
}
