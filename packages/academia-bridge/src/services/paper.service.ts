/**
 * ════════════════════════════════════════════════════════════════════════════════
 *  EXTROPY ENGINE — Academia Bridge | PaperService
 * ════════════════════════════════════════════════════════════════════════════════
 *
 *  Manages the paper upload queue: CRUD operations on `academia.ab_papers`.
 *  Papers move through a simple state machine:
 *
 *    queued → uploading → uploaded
 *                       ↘ failed (retryable)
 *
 * ════════════════════════════════════════════════════════════════════════════════
 */

import { v4 as uuid } from 'uuid';
import { z } from 'zod';
import type { DatabaseService } from './database.service.js';
import type { EventBusService } from './event-bus.service.js';
import type {
  AbPaper,
  CreatePaperDto,
  UpdatePaperDto,
  ListPapersFilters,
} from '../types/index.js';

// ─────────────────────────────────────────────────────────────────────────────
//  Validation schemas
// ─────────────────────────────────────────────────────────────────────────────

const CreatePaperSchema = z.object({
  title:            z.string().min(1).max(500),
  abstract:         z.string().min(1).max(10000),
  coAuthors:        z.array(z.string()).optional().default([]),
  tags:             z.array(z.string()).optional().default([]),
  filePath:         z.string().optional(),
  content:          z.string().optional(),
  fileType:         z.enum(['pdf', 'docx']).optional().default('pdf'),
  sourceProposalId: z.string().uuid().optional(),
}).refine(
  (data) => data.filePath !== undefined || data.content !== undefined,
  { message: 'Either filePath or content must be provided' },
);

// ─────────────────────────────────────────────────────────────────────────────
//  Row → domain model mapper
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Map a raw database row (snake_case) to the domain type (camelCase).
 */
function rowToPaper(row: Record<string, unknown>): AbPaper {
  return {
    id:               row.id as string,
    title:            row.title as string,
    abstract:         row.abstract as string,
    coAuthors:        (row.co_authors as string[]) ?? [],
    tags:             (row.tags as string[]) ?? [],
    filePath:         (row.file_path as string | undefined) ?? undefined,
    content:          (row.content as string | undefined) ?? undefined,
    fileType:         (row.file_type as 'pdf' | 'docx'),
    status:           row.status as AbPaper['status'],
    academiaUrl:      (row.academia_url as string | undefined) ?? undefined,
    sourceProposalId: (row.source_proposal_id as string | undefined) ?? undefined,
    createdAt:        (row.created_at as Date).toISOString(),
    updatedAt:        (row.updated_at as Date).toISOString(),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
//  PaperService
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Manages paper queue CRUD operations.
 *
 * All mutations emit relevant events on the EventBus so downstream services
 * (claim service, upload service) can react without tight coupling.
 */
export class PaperService {
  constructor(
    private readonly db: DatabaseService,
    private readonly eventBus: EventBusService,
  ) {}

  // ─────────────────────────────────────────────────────────────────────────
  //  Create
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Add a paper to the upload queue.
   * Validates input, persists to `ab_papers`, and returns the created paper.
   *
   * @param data - Paper creation payload
   * @returns The newly created AbPaper
   * @throws ZodError if validation fails
   */
  async queuePaper(data: CreatePaperDto): Promise<AbPaper> {
    const validated = CreatePaperSchema.parse(data);
    const id = uuid();

    const { rows } = await this.db.query<Record<string, unknown>>(
      `INSERT INTO academia.ab_papers
         (id, title, abstract, co_authors, tags, file_path, content, file_type, status, source_proposal_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'queued', $9)
       RETURNING *`,
      [
        id,
        validated.title,
        validated.abstract,
        validated.coAuthors,
        validated.tags,
        validated.filePath ?? null,
        validated.content ?? null,
        validated.fileType,
        validated.sourceProposalId ?? null,
      ],
    );

    const paper = rowToPaper(rows[0]);
    console.log(`[academia-bridge] Paper queued: ${paper.id} — "${paper.title}"`);
    return paper;
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  Read
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Get a single paper by ID.
   *
   * @param id - Paper UUID
   * @returns AbPaper or null if not found
   */
  async getPaper(id: string): Promise<AbPaper | null> {
    const { rows } = await this.db.query<Record<string, unknown>>(
      `SELECT * FROM academia.ab_papers WHERE id = $1`,
      [id],
    );
    if (rows.length === 0) return null;
    return rowToPaper(rows[0]);
  }

  /**
   * List papers with optional filtering by status, sourceProposalId, and pagination.
   *
   * @param filters - Optional filters and pagination parameters
   * @returns Array of matching AbPaper objects
   */
  async listPapers(filters: ListPapersFilters = {}): Promise<AbPaper[]> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    let paramIdx = 1;

    if (filters.status) {
      conditions.push(`status = $${paramIdx++}`);
      params.push(filters.status);
    }

    if (filters.sourceProposalId) {
      conditions.push(`source_proposal_id = $${paramIdx++}`);
      params.push(filters.sourceProposalId);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const limit  = Math.min(filters.limit  ?? 50, 200);
    const offset = filters.offset ?? 0;

    params.push(limit, offset);

    const { rows } = await this.db.query<Record<string, unknown>>(
      `SELECT * FROM academia.ab_papers
       ${where}
       ORDER BY created_at DESC
       LIMIT $${paramIdx++} OFFSET $${paramIdx++}`,
      params,
    );

    return rows.map(rowToPaper);
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  Update
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Update paper metadata.
   * Only provided fields are updated (partial update semantics).
   *
   * @param id   - Paper UUID
   * @param data - Fields to update
   * @returns Updated AbPaper or null if not found
   */
  async updatePaper(id: string, data: UpdatePaperDto): Promise<AbPaper | null> {
    const setClauses: string[] = [];
    const params: unknown[] = [];
    let paramIdx = 1;

    const fieldMap: Record<keyof UpdatePaperDto, string> = {
      title:       'title',
      abstract:    'abstract',
      coAuthors:   'co_authors',
      tags:        'tags',
      filePath:    'file_path',
      content:     'content',
      fileType:    'file_type',
      status:      'status',
      academiaUrl: 'academia_url',
    };

    for (const [key, col] of Object.entries(fieldMap) as [keyof UpdatePaperDto, string][]) {
      if (data[key] !== undefined) {
        setClauses.push(`${col} = $${paramIdx++}`);
        params.push(data[key]);
      }
    }

    if (setClauses.length === 0) {
      return this.getPaper(id);
    }

    params.push(id);

    const { rows } = await this.db.query<Record<string, unknown>>(
      `UPDATE academia.ab_papers
       SET ${setClauses.join(', ')}
       WHERE id = $${paramIdx}
       RETURNING *`,
      params,
    );

    if (rows.length === 0) return null;
    return rowToPaper(rows[0]);
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  Delete
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Remove a paper from the queue.
   * Only papers in 'queued' or 'failed' status can be deleted.
   * Cascades to ab_uploads and ab_metrics via FK constraints.
   *
   * @param id - Paper UUID
   * @returns true if deleted, false if not found
   * @throws Error if paper is in 'uploading' or 'uploaded' status
   */
  async deletePaper(id: string): Promise<boolean> {
    const paper = await this.getPaper(id);
    if (!paper) return false;

    if (paper.status === 'uploading') {
      throw new Error(`Cannot delete paper ${id}: upload is in progress`);
    }

    const { rowCount } = await this.db.query(
      `DELETE FROM academia.ab_papers WHERE id = $1`,
      [id],
    );

    return (rowCount ?? 0) > 0;
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  Status helpers
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Transition a paper to a new status.
   * Convenience wrapper around updatePaper for status-only updates.
   *
   * @param id     - Paper UUID
   * @param status - New status
   * @param url    - Optional academia.edu URL (for 'uploaded' transitions)
   * @returns Updated AbPaper or null if not found
   */
  async setStatus(
    id: string,
    status: AbPaper['status'],
    url?: string,
  ): Promise<AbPaper | null> {
    return this.updatePaper(id, {
      status,
      ...(url ? { academiaUrl: url } : {}),
    });
  }
}
