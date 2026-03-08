/**
 * ════════════════════════════════════════════════════════════════════════════════
 *  GrantFlow Proposer — Proposal Service
 * ════════════════════════════════════════════════════════════════════════════════
 *
 *  Core proposal management. A GfProposal is the top-level aggregate for
 *  a grant proposal document. It is always linked to a submission record
 *  from grantflow-discovery via `submissionId`.
 *
 *  Responsibilities:
 *    - CRUD operations for gf_proposals
 *    - Aggregating sections into the proposal response object
 *    - Maintaining the composite quality_score (average of section scores)
 *    - Status lifecycle management (draft → generating → complete → exported)
 *
 * ════════════════════════════════════════════════════════════════════════════════
 */

import { v4 as uuid } from 'uuid';
import type { DatabaseService } from './database.service.js';
import type { EventBusService } from './event-bus.service.js';
import type {
  GfProposal,
  GfSection,
  CreateProposalInput,
  UpdateProposalInput,
  ListProposalsFilter,
  ProposalStatus,
  SectionType,
} from '../types/index.js';

// ─────────────────────────────────────────────────────────────────────────────
//  Database Row Types
// ─────────────────────────────────────────────────────────────────────────────

interface ProposalRow {
  id:                     string;
  submission_id:          string;
  opportunity_title:      string;
  agency:                 string;
  opportunity_number:     string | null;
  principal_investigator: string | null;
  requested_amount:       string | null;
  proposal_duration:      string | null;
  status:                 string;
  quality_score:          string;
  created_at:             Date;
  updated_at:             Date;
}

interface SectionRow {
  id:               string;
  proposal_id:      string;
  section_type:     string;
  content:          string;
  version:          number;
  quality_score:    string;
  is_ai_generated:  boolean;
  created_at:       Date;
  updated_at:       Date;
}

// ─────────────────────────────────────────────────────────────────────────────
//  ProposalService
// ─────────────────────────────────────────────────────────────────────────────

export class ProposalService {
  constructor(
    private readonly db: DatabaseService,
    private readonly eventBus: EventBusService,
  ) {}

  // ── Mappers ────────────────────────────────────────────────────────────────

  /**
   * Map a database row to a GfProposal domain object (without sections).
   */
  private mapProposal(row: ProposalRow): GfProposal {
    return {
      id:                     row.id,
      submissionId:           row.submission_id,
      opportunityTitle:       row.opportunity_title,
      agency:                 row.agency,
      opportunityNumber:      row.opportunity_number ?? undefined,
      principalInvestigator:  row.principal_investigator ?? undefined,
      requestedAmount:        row.requested_amount ? parseFloat(row.requested_amount) : undefined,
      proposalDuration:       row.proposal_duration ?? undefined,
      status:                 row.status as ProposalStatus,
      qualityScore:           parseFloat(row.quality_score),
      sections:               [],
      createdAt:              row.created_at.toISOString(),
      updatedAt:              row.updated_at.toISOString(),
    };
  }

  /**
   * Map a database row to a GfSection domain object.
   */
  private mapSection(row: SectionRow): GfSection {
    return {
      id:             row.id,
      proposalId:     row.proposal_id,
      sectionType:    row.section_type as SectionType,
      content:        row.content,
      version:        row.version,
      qualityScore:   parseFloat(row.quality_score),
      isAiGenerated:  row.is_ai_generated,
      createdAt:      row.created_at.toISOString(),
      updatedAt:      row.updated_at.toISOString(),
    };
  }

  // ── Create ─────────────────────────────────────────────────────────────────

  /**
   * Create a new grant proposal linked to a discovery submission.
   * The proposal starts in 'draft' status with a quality score of 0.
   *
   * @param input - Proposal creation parameters (submissionId, title, agency, …)
   * @returns The newly created GfProposal with empty sections array
   */
  async createProposal(input: CreateProposalInput): Promise<GfProposal> {
    const id = uuid();

    const { rows } = await this.db.query<ProposalRow>(
      `INSERT INTO gf_proposals
         (id, submission_id, opportunity_title, agency, opportunity_number,
          principal_investigator, requested_amount, proposal_duration,
          status, quality_score)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'draft', 0)
       RETURNING *`,
      [
        id,
        input.submissionId,
        input.opportunityTitle,
        input.agency,
        input.opportunityNumber ?? null,
        input.principalInvestigator ?? null,
        input.requestedAmount ?? null,
        input.proposalDuration ?? null,
      ],
    );

    const proposal = this.mapProposal(rows[0]);
    console.log(`[proposer] Created proposal ${id} for submission ${input.submissionId}`);
    return proposal;
  }

  // ── Read ───────────────────────────────────────────────────────────────────

  /**
   * Get a single proposal by ID, including all of its sections.
   *
   * @param id - The proposal UUID
   * @returns The full GfProposal with populated sections, or null if not found
   */
  async getProposal(id: string): Promise<GfProposal | null> {
    const { rows } = await this.db.query<ProposalRow>(
      'SELECT * FROM gf_proposals WHERE id = $1',
      [id],
    );

    if (rows.length === 0) return null;

    const proposal = this.mapProposal(rows[0]);

    // Fetch associated sections ordered by creation time
    const { rows: sectionRows } = await this.db.query<SectionRow>(
      'SELECT * FROM gf_sections WHERE proposal_id = $1 ORDER BY created_at ASC',
      [id],
    );

    proposal.sections = sectionRows.map(r => this.mapSection(r));
    return proposal;
  }

  /**
   * List proposals with optional filtering.
   * Returns proposals without sections (for list views — fetch individually for details).
   *
   * @param filters - Optional filters: submissionId, status, agency, limit, offset
   */
  async listProposals(filters: ListProposalsFilter = {}): Promise<GfProposal[]> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    let i = 1;

    if (filters.submissionId) {
      conditions.push(`submission_id = $${i++}`);
      params.push(filters.submissionId);
    }
    if (filters.status) {
      conditions.push(`status = $${i++}`);
      params.push(filters.status);
    }
    if (filters.agency) {
      conditions.push(`LOWER(agency) LIKE $${i++}`);
      params.push(`%${filters.agency.toLowerCase()}%`);
    }

    const where  = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit  = filters.limit  ?? 50;
    const offset = filters.offset ?? 0;

    const { rows } = await this.db.query<ProposalRow>(
      `SELECT * FROM gf_proposals ${where} ORDER BY created_at DESC LIMIT $${i++} OFFSET $${i++}`,
      [...params, limit, offset],
    );

    return rows.map(r => this.mapProposal(r));
  }

  // ── Update ─────────────────────────────────────────────────────────────────

  /**
   * Update proposal metadata fields.
   * Only the fields present in `data` will be updated; omitted fields are unchanged.
   *
   * @param id   - The proposal UUID
   * @param data - Fields to update
   * @returns The updated GfProposal, or null if not found
   */
  async updateProposal(id: string, data: UpdateProposalInput): Promise<GfProposal | null> {
    const sets: string[] = [];
    const params: unknown[] = [];
    let i = 1;

    if (data.opportunityTitle    !== undefined) { sets.push(`opportunity_title = $${i++}`);       params.push(data.opportunityTitle); }
    if (data.agency              !== undefined) { sets.push(`agency = $${i++}`);                  params.push(data.agency); }
    if (data.opportunityNumber   !== undefined) { sets.push(`opportunity_number = $${i++}`);      params.push(data.opportunityNumber); }
    if (data.principalInvestigator !== undefined) { sets.push(`principal_investigator = $${i++}`); params.push(data.principalInvestigator); }
    if (data.requestedAmount     !== undefined) { sets.push(`requested_amount = $${i++}`);        params.push(data.requestedAmount); }
    if (data.proposalDuration    !== undefined) { sets.push(`proposal_duration = $${i++}`);       params.push(data.proposalDuration); }
    if (data.status              !== undefined) { sets.push(`status = $${i++}`);                  params.push(data.status); }

    if (sets.length === 0) return this.getProposal(id);

    sets.push(`updated_at = NOW()`);
    params.push(id);

    const { rows } = await this.db.query<ProposalRow>(
      `UPDATE gf_proposals SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`,
      params,
    );

    if (rows.length === 0) return null;
    return this.getProposal(id);
  }

  // ── Quality Score ──────────────────────────────────────────────────────────

  /**
   * Recompute and persist the proposal's composite quality score.
   * The score is the arithmetic mean of all section quality scores.
   * If there are no sections, the score is 0.
   *
   * @param proposalId - The proposal UUID
   */
  async recomputeQualityScore(proposalId: string): Promise<number> {
    const { rows } = await this.db.query<{ avg_score: string }>(
      'SELECT AVG(quality_score)::NUMERIC(5,2) AS avg_score FROM gf_sections WHERE proposal_id = $1',
      [proposalId],
    );

    const score = rows[0]?.avg_score ? parseFloat(rows[0].avg_score) : 0;

    await this.db.query(
      'UPDATE gf_proposals SET quality_score = $1, updated_at = NOW() WHERE id = $2',
      [score, proposalId],
    );

    return score;
  }

  // ── Status Transitions ─────────────────────────────────────────────────────

  /**
   * Transition proposal status.
   *
   * @param id     - The proposal UUID
   * @param status - The new status
   */
  async setStatus(id: string, status: ProposalStatus): Promise<void> {
    await this.db.query(
      "UPDATE gf_proposals SET status = $1, updated_at = NOW() WHERE id = $2",
      [status, id],
    );
  }
}
