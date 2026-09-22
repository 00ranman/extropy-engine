/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  GrantFlow Discovery — Submission Service
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *  Tracks grant applications through the full submission pipeline:
 *
 *    discovered → researching → drafting → review → submitted → awarded/declined
 *
 *  Also handles:
 *  - Preparing S2S XML packages for Grants.gov SOAP submission
 *  - Forwarding matched grants to grantflow-proposer for proposal generation
 *  - Audit trail (status history with timestamps and notes)
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { v4 as uuid } from 'uuid';
import type { DatabaseService } from './database.service.js';
import type {
  GfSubmission,
  GfSubmissionCreate,
  GfSubmissionFilters,
  GfSubmissionStatus,
  GfStatusHistoryEntry,
} from '../types/index.js';

/** Valid status transitions for the submission pipeline */
const VALID_TRANSITIONS: Record<GfSubmissionStatus, GfSubmissionStatus[]> = {
  discovered:  ['researching', 'withdrawn'],
  researching: ['drafting', 'withdrawn'],
  drafting:    ['review', 'withdrawn'],
  review:      ['submitted', 'drafting', 'withdrawn'],
  submitted:   ['awarded', 'declined'],
  awarded:     [],
  declined:    [],
  withdrawn:   [],
};

export class SubmissionService {
  constructor(
    private readonly db: DatabaseService,
    private readonly grantflowProposerUrl: string,
  ) {}

  // ─────────────────────────────────────────────────────────────────────────
  //  Pipeline Management
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Create a new submission pipeline entry for an opportunity.
   * Initial status is 'discovered'.
   *
   * @param data - Opportunity ID, profile ID, and optional notes
   * @returns Newly created GfSubmission
   */
  async createSubmission(data: GfSubmissionCreate): Promise<GfSubmission> {
    const id  = uuid();
    const now = new Date().toISOString();

    const initialHistory: GfStatusHistoryEntry[] = [
      {
        status:    'discovered',
        timestamp: now,
        notes:     data.notes ?? 'Submission pipeline opened',
      },
    ];

    await this.db.query(
      `INSERT INTO gf_submissions (
        id, opportunity_id, profile_id, status, status_history, notes, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        id,
        data.opportunityId,
        data.profileId,
        'discovered',
        JSON.stringify(initialHistory),
        data.notes ?? null,
        now,
        now,
      ],
    );

    console.log(
      `[submission] Created submission — id=${id} opp=${data.opportunityId}`,
    );

    return {
      id,
      opportunityId:  data.opportunityId,
      profileId:      data.profileId,
      status:         'discovered',
      statusHistory:  initialHistory,
      notes:          data.notes,
      createdAt:      now,
      updatedAt:      now,
    };
  }

  /**
   * Advance a submission to a new pipeline status.
   * Validates the transition is legal according to VALID_TRANSITIONS.
   *
   * @param submissionId - Submission UUID
   * @param newStatus    - Target status to transition to
   * @param notes        - Optional notes to record with this transition
   * @param actorId      - Optional ID of the actor making the change
   * @returns Updated GfSubmission
   */
  async updateStatus(
    submissionId: string,
    newStatus: GfSubmissionStatus,
    notes?: string,
    actorId?: string,
  ): Promise<GfSubmission> {
    const submission = await this.getSubmission(submissionId);
    if (!submission) {
      throw new Error(`Submission ${submissionId} not found`);
    }

    const allowedTransitions = VALID_TRANSITIONS[submission.status];
    if (!allowedTransitions.includes(newStatus)) {
      throw new Error(
        `Invalid status transition: ${submission.status} → ${newStatus}. ` +
        `Allowed: [${allowedTransitions.join(', ')}]`,
      );
    }

    const now = new Date().toISOString();
    const historyEntry: GfStatusHistoryEntry = {
      status:    newStatus,
      timestamp: now,
      notes,
      actorId,
    };

    const newHistory = [...submission.statusHistory, historyEntry];

    const extraUpdates: Record<string, unknown> = {};
    if (newStatus === 'submitted') {
      extraUpdates['submitted_at'] = now;
    }

    await this.db.query(
      `UPDATE gf_submissions SET
        status         = $2,
        status_history = $3,
        submitted_at   = COALESCE($4, submitted_at),
        updated_at     = $5
      WHERE id = $1`,
      [
        submissionId,
        newStatus,
        JSON.stringify(newHistory),
        extraUpdates['submitted_at'] ?? null,
        now,
      ],
    );

    console.log(
      `[submission] Status updated — id=${submissionId} ${submission.status} → ${newStatus}`,
    );

    return {
      ...submission,
      status:         newStatus,
      statusHistory:  newHistory,
      submittedAt:    newStatus === 'submitted' ? now : submission.submittedAt,
      updatedAt:      now,
    };
  }

  /**
   * Retrieve a submission by its UUID.
   *
   * @param id - Submission UUID
   * @returns GfSubmission or null
   */
  async getSubmission(id: string): Promise<GfSubmission | null> {
    const { rows } = await this.db.query(
      'SELECT * FROM gf_submissions WHERE id = $1',
      [id],
    );
    if (rows.length === 0) return null;
    return this.rowToSubmission(rows[0]);
  }

  /**
   * List submissions with optional filtering.
   *
   * @param filters - Filter by profile, opportunity, status, pagination
   */
  async getSubmissions(filters: GfSubmissionFilters = {}): Promise<GfSubmission[]> {
    let sql = 'SELECT * FROM gf_submissions WHERE 1=1';
    const params: unknown[] = [];

    if (filters.profileId) {
      params.push(filters.profileId);
      sql += ` AND profile_id = $${params.length}`;
    }

    if (filters.opportunityId) {
      params.push(filters.opportunityId);
      sql += ` AND opportunity_id = $${params.length}`;
    }

    if (filters.status) {
      const statuses = Array.isArray(filters.status)
        ? filters.status
        : [filters.status];
      params.push(statuses);
      sql += ` AND status = ANY($${params.length})`;
    }

    sql += ' ORDER BY created_at DESC';

    if (filters.limit) {
      params.push(filters.limit);
      sql += ` LIMIT $${params.length}`;
    }

    if (filters.offset) {
      params.push(filters.offset);
      sql += ` OFFSET $${params.length}`;
    }

    const { rows } = await this.db.query(sql, params);
    return rows.map(r => this.rowToSubmission(r));
  }

  /**
   * Set the proposal ID on a submission (links to grantflow-proposer).
   *
   * @param submissionId - Submission UUID
   * @param proposalId   - Proposal ID from grantflow-proposer
   */
  async setProposalId(submissionId: string, proposalId: string): Promise<void> {
    await this.db.query(
      `UPDATE gf_submissions SET proposal_id = $2, updated_at = NOW() WHERE id = $1`,
      [submissionId, proposalId],
    );
  }

  /**
   * Set the Grants.gov tracking number after a successful S2S submission.
   */
  async setTrackingNumber(submissionId: string, trackingNumber: string): Promise<void> {
    await this.db.query(
      `UPDATE gf_submissions SET grants_gov_tracking_number = $2, updated_at = NOW() WHERE id = $1`,
      [submissionId, trackingNumber],
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  S2S Package Preparation
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Prepare an XML S2S submission package for a submission.
   *
   * This generates a minimal SF-424 compliant XML scaffold pre-filled with
   * opportunity and profile data. The actual application content would be
   * populated by grantflow-proposer before final submission.
   *
   * @param submissionId - Submission UUID
   * @returns The generated XML string (also stored in the database)
   */
  async prepareS2SPackage(submissionId: string): Promise<string> {
    const submission = await this.getSubmission(submissionId);
    if (!submission) {
      throw new Error(`Submission ${submissionId} not found`);
    }

    // Fetch opportunity and profile data
    const { rows: oppRows } = await this.db.query(
      'SELECT * FROM gf_opportunities WHERE id = $1',
      [submission.opportunityId],
    );
    const { rows: profileRows } = await this.db.query(
      'SELECT * FROM gf_profiles WHERE id = $1',
      [submission.profileId],
    );

    if (oppRows.length === 0) throw new Error(`Opportunity ${submission.opportunityId} not found`);
    if (profileRows.length === 0) throw new Error(`Profile ${submission.profileId} not found`);

    const opp     = oppRows[0];
    const profile = profileRows[0];

    const xml = this.buildSF424XML(submissionId, opp, profile);

    // Store in database
    await this.db.query(
      `UPDATE gf_submissions SET s2s_package_xml = $2, updated_at = NOW() WHERE id = $1`,
      [submissionId, xml],
    );

    console.log(`[submission] S2S package prepared — submission=${submissionId}`);
    return xml;
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  Proposer Integration
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Forward a submission to grantflow-proposer to initiate proposal generation.
   * Returns the created proposal ID.
   *
   * @param submissionId - Submission UUID
   * @returns Proposal ID from grantflow-proposer
   */
  async requestProposalGeneration(submissionId: string): Promise<string> {
    const submission = await this.getSubmission(submissionId);
    if (!submission) {
      throw new Error(`Submission ${submissionId} not found`);
    }

    try {
      const response = await fetch(`${this.grantflowProposerUrl}/api/v1/proposals`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          submissionId:  submission.id,
          opportunityId: submission.opportunityId,
          profileId:     submission.profileId,
        }),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Proposer returned ${response.status}: ${text.slice(0, 200)}`);
      }

      const result = await response.json() as { id?: string; proposalId?: string };
      const proposalId = result.id ?? result.proposalId ?? uuid();

      await this.setProposalId(submissionId, proposalId);
      console.log(
        `[submission] Proposal generation requested — submission=${submissionId} proposal=${proposalId}`,
      );

      return proposalId;
    } catch (err) {
      console.warn(
        `[submission] Could not reach grantflow-proposer: ${(err as Error).message}`,
      );
      // Return a placeholder proposal ID so pipeline can continue
      const proposalId = `placeholder-${uuid()}`;
      await this.setProposalId(submissionId, proposalId);
      return proposalId;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  Private Helpers
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Build a minimal SF-424 XML scaffold for S2S submission.
   * This is a template — actual content is filled in by grantflow-proposer.
   */
  private buildSF424XML(
    submissionId: string,
    opp: Record<string, unknown>,
    profile: Record<string, unknown>,
  ): string {
    return `<?xml version="1.0" encoding="UTF-8"?>
<!-- GrantFlow Discovery S2S Package -->
<!-- Generated: ${new Date().toISOString()} -->
<!-- Submission ID: ${submissionId} -->
<ns0:ApplicationPackage
  xmlns:ns0="http://apply.grants.gov/system/ApplicantWebServices-V2.0"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">

  <ApplicationHeader>
    <GrantsGovOpportunityNumber>${this.escapeXml(String(opp['opp_number'] ?? ''))}</GrantsGovOpportunityNumber>
    <GrantsGovOpportunityTitle>${this.escapeXml(String(opp['title'] ?? ''))}</GrantsGovOpportunityTitle>
    <AgencyName>${this.escapeXml(String(opp['agency'] ?? ''))}</AgencyName>
    <SubmissionId>${submissionId}</SubmissionId>
    <PreparedAt>${new Date().toISOString()}</PreparedAt>
  </ApplicationHeader>

  <!-- SF-424 Application for Federal Assistance -->
  <SF424>
    <ApplicantInformation>
      <OrganizationName>${this.escapeXml(String(profile['name'] ?? ''))}</OrganizationName>
      <ContactEmail>${this.escapeXml(String(profile['email'] ?? ''))}</ContactEmail>
    </ApplicantInformation>
    <ProjectInformation>
      <ProjectTitle><!-- TO BE COMPLETED BY PROPOSER --></ProjectTitle>
      <ProjectNarrative><!-- TO BE COMPLETED BY PROPOSER --></ProjectNarrative>
      <BudgetJustification><!-- TO BE COMPLETED BY PROPOSER --></BudgetJustification>
    </ProjectInformation>
    <Budget>
      <RequestedAmount><!-- TO BE COMPLETED --></RequestedAmount>
    </Budget>
  </SF424>

</ns0:ApplicationPackage>`;
  }

  /**
   * Escape XML special characters.
   */
  private escapeXml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  /**
   * Convert a database row to a GfSubmission.
   */
  private rowToSubmission(row: Record<string, unknown>): GfSubmission {
    let statusHistory: GfStatusHistoryEntry[] = [];
    try {
      const raw = row['status_history'];
      if (typeof raw === 'string') {
        statusHistory = JSON.parse(raw);
      } else if (Array.isArray(raw)) {
        statusHistory = raw as GfStatusHistoryEntry[];
      }
    } catch {
      statusHistory = [];
    }

    return {
      id:                       row['id'] as string,
      opportunityId:            row['opportunity_id'] as string,
      profileId:                row['profile_id'] as string,
      proposalId:               row['proposal_id'] as string | undefined,
      status:                   row['status'] as GfSubmissionStatus,
      statusHistory,
      s2sPackageXml:            row['s2s_package_xml'] as string | undefined,
      submittedAt:              row['submitted_at'] ? (row['submitted_at'] as Date).toISOString() : undefined,
      grantsGovTrackingNumber:  row['grants_gov_tracking_number'] as string | undefined,
      notes:                    row['notes'] as string | undefined,
      createdAt:                (row['created_at'] as Date).toISOString(),
      updatedAt:                (row['updated_at'] as Date).toISOString(),
    };
  }
}
