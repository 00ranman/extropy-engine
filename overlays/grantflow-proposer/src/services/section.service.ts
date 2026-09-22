/**
 * ════════════════════════════════════════════════════════════════════════════════
 *  GrantFlow Proposer — Section Service
 * ════════════════════════════════════════════════════════════════════════════════
 *
 *  Manages individual proposal sections. Each section is a versioned text blob
 *  representing one part of the grant proposal document (Executive Summary,
 *  Project Narrative, Budget Justification, etc.).
 *
 *  Section versioning: every call to updateSection increments the `version`
 *  counter, providing an implicit audit trail. For full history, use the
 *  gf_refinements table (managed by GenerationService).
 *
 * ════════════════════════════════════════════════════════════════════════════════
 */

import { v4 as uuid } from 'uuid';
import type { DatabaseService } from './database.service.js';
import type { EventBusService } from './event-bus.service.js';
import type {
  GfSection,
  SectionType,
  AddSectionInput,
  UpdateSectionInput,
} from '../types/index.js';

// ─────────────────────────────────────────────────────────────────────────────
//  Database Row Type
// ─────────────────────────────────────────────────────────────────────────────

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
//  SectionService
// ─────────────────────────────────────────────────────────────────────────────

export class SectionService {
  constructor(
    private readonly db: DatabaseService,
    private readonly eventBus: EventBusService,
  ) {}

  // ── Mapper ─────────────────────────────────────────────────────────────────

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
   * Add a new section to a proposal.
   * If a section of this type already exists, it is replaced (upsert by section_type).
   * This enforces the invariant that each proposal has at most one section per type.
   *
   * @param proposalId  - The parent proposal UUID
   * @param input       - Section type, content, and AI generation flag
   * @returns The created or replaced GfSection
   */
  async addSection(proposalId: string, input: AddSectionInput): Promise<GfSection> {
    // Check if a section of this type already exists — if so, replace it
    const existing = await this.getSectionByType(proposalId, input.sectionType);

    if (existing) {
      // Replace existing section content, increment version
      const { rows } = await this.db.query<SectionRow>(
        `UPDATE gf_sections
         SET content = $1, version = version + 1,
             is_ai_generated = $2, updated_at = NOW()
         WHERE id = $3
         RETURNING *`,
        [input.content, input.isAiGenerated ?? false, existing.id],
      );
      const section = this.mapSection(rows[0]);
      console.log(`[proposer:section] Replaced section ${existing.id} (type=${input.sectionType})`);
      return section;
    }

    const id = uuid();
    const { rows } = await this.db.query<SectionRow>(
      `INSERT INTO gf_sections
         (id, proposal_id, section_type, content, version, quality_score, is_ai_generated)
       VALUES ($1, $2, $3, $4, 1, 0, $5)
       RETURNING *`,
      [id, proposalId, input.sectionType, input.content, input.isAiGenerated ?? false],
    );

    const section = this.mapSection(rows[0]);
    console.log(`[proposer:section] Added section ${id} (type=${input.sectionType}) to proposal ${proposalId}`);
    return section;
  }

  // ── Read ───────────────────────────────────────────────────────────────────

  /**
   * Get a single section by its UUID.
   *
   * @param proposalId - The parent proposal UUID (for access control validation)
   * @param sectionId  - The section UUID
   * @returns The GfSection, or null if not found
   */
  async getSection(proposalId: string, sectionId: string): Promise<GfSection | null> {
    const { rows } = await this.db.query<SectionRow>(
      'SELECT * FROM gf_sections WHERE id = $1 AND proposal_id = $2',
      [sectionId, proposalId],
    );
    return rows.length > 0 ? this.mapSection(rows[0]) : null;
  }

  /**
   * Get a section by its type within a proposal.
   * Returns the first match (each proposal should have at most one per type).
   *
   * @param proposalId   - The parent proposal UUID
   * @param sectionType  - The section type to look up
   */
  async getSectionByType(proposalId: string, sectionType: SectionType): Promise<GfSection | null> {
    const { rows } = await this.db.query<SectionRow>(
      'SELECT * FROM gf_sections WHERE proposal_id = $1 AND section_type = $2',
      [proposalId, sectionType],
    );
    return rows.length > 0 ? this.mapSection(rows[0]) : null;
  }

  /**
   * List all sections for a proposal, ordered by creation time.
   *
   * @param proposalId - The parent proposal UUID
   */
  async listSections(proposalId: string): Promise<GfSection[]> {
    const { rows } = await this.db.query<SectionRow>(
      'SELECT * FROM gf_sections WHERE proposal_id = $1 ORDER BY created_at ASC',
      [proposalId],
    );
    return rows.map(r => this.mapSection(r));
  }

  // ── Update ─────────────────────────────────────────────────────────────────

  /**
   * Update the content of an existing section.
   * Increments the version counter and records the updated_at timestamp.
   *
   * @param proposalId - The parent proposal UUID
   * @param sectionId  - The section UUID
   * @param input      - New content
   * @returns The updated GfSection, or null if not found
   */
  async updateSection(
    proposalId: string,
    sectionId: string,
    input: UpdateSectionInput,
  ): Promise<GfSection | null> {
    const { rows } = await this.db.query<SectionRow>(
      `UPDATE gf_sections
       SET content = $1, version = version + 1, updated_at = NOW()
       WHERE id = $2 AND proposal_id = $3
       RETURNING *`,
      [input.content, sectionId, proposalId],
    );

    if (rows.length === 0) return null;
    const section = this.mapSection(rows[0]);
    console.log(`[proposer:section] Updated section ${sectionId} (v${section.version})`);
    return section;
  }

  // ── Quality Score ──────────────────────────────────────────────────────────

  /**
   * Persist a quality score for a section.
   *
   * @param sectionId    - The section UUID
   * @param qualityScore - Score in the range [0, 100]
   */
  async setQualityScore(sectionId: string, qualityScore: number): Promise<void> {
    await this.db.query(
      'UPDATE gf_sections SET quality_score = $1, updated_at = NOW() WHERE id = $2',
      [Math.min(100, Math.max(0, qualityScore)), sectionId],
    );
  }

  // ── Delete ─────────────────────────────────────────────────────────────────

  /**
   * Remove a section from a proposal.
   * Also deletes all associated refinement records (via cascade).
   *
   * @param proposalId - The parent proposal UUID
   * @param sectionId  - The section UUID
   * @returns true if the section was deleted, false if not found
   */
  async deleteSection(proposalId: string, sectionId: string): Promise<boolean> {
    const { rowCount } = await this.db.query(
      'DELETE FROM gf_sections WHERE id = $1 AND proposal_id = $2',
      [sectionId, proposalId],
    );
    return rowCount > 0;
  }
}
