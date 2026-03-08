/**
 * ════════════════════════════════════════════════════════════════════════════════
 *  EXTROPY ENGINE — Academia Bridge Types
 * ════════════════════════════════════════════════════════════════════════════════
 *
 *  Domain types for the academia-bridge service.
 *  All entities map 1:1 to database tables with snake_case ↔ camelCase conversion.
 *
 * ════════════════════════════════════════════════════════════════════════════════
 */

// ─────────────────────────────────────────────────────────────────────────────
//  Paper — the core entity
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A paper queued or uploaded to academia.edu.
 * Papers can be provided as a file path (for existing files) or as raw content
 * (for programmatically-generated documents that need to be written to disk first).
 */
export interface AbPaper {
  /** UUID primary key */
  id: string;

  /** Full paper title as it will appear on academia.edu */
  title: string;

  /** Paper abstract (500-2000 words recommended by academia.edu) */
  abstract: string;

  /** Co-authors listed by full name */
  coAuthors: string[];

  /** Keywords/tags for discoverability */
  tags: string[];

  /**
   * Absolute path to an existing PDF or DOCX file on disk.
   * Mutually exclusive with `content` — use one or the other.
   */
  filePath?: string;

  /**
   * Raw text/markdown content to be written to a temp file before upload.
   * Mutually exclusive with `filePath` — use one or the other.
   */
  content?: string;

  /** File format for the uploaded document */
  fileType: 'pdf' | 'docx';

  /** Current lifecycle status of the paper */
  status: 'queued' | 'uploading' | 'uploaded' | 'failed';

  /** Public academia.edu URL — populated after successful upload */
  academiaUrl?: string;

  /** Optional back-reference to the originating grantflow-proposer proposal */
  sourceProposalId?: string;

  /** ISO-8601 creation timestamp */
  createdAt: string;

  /** ISO-8601 last-updated timestamp */
  updatedAt: string;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Upload — execution log for upload attempts
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A single upload attempt for a paper.
 * Multiple uploads can exist per paper (due to retries).
 * The most recent upload with status='success' determines the canonical URL.
 */
export interface AbUpload {
  /** UUID primary key */
  id: string;

  /** Foreign key → ab_papers.id */
  paperId: string;

  /** Status of this specific upload attempt */
  status: 'pending' | 'in_progress' | 'success' | 'failed';

  /** Public academia.edu URL — populated on success */
  academiaUrl?: string;

  /** Detailed error message — populated on failure */
  errorMessage?: string;

  /** Number of times this upload has been retried (max 3) */
  retryCount: number;

  /** ISO-8601 timestamp when upload was initiated */
  startedAt: string;

  /** ISO-8601 timestamp when upload completed (success or final failure) */
  completedAt?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Metrics — view/download performance tracking
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Performance metrics for an uploaded paper.
 * Collected by browser scraping the paper's public academia.edu page.
 */
export interface AbMetrics {
  /** Foreign key → ab_papers.id (also primary key — one row per paper) */
  paperId: string;

  /** Public academia.edu URL for the paper */
  academiaUrl: string;

  /** Total view count as reported by academia.edu */
  views: number;

  /** Total download count as reported by academia.edu */
  downloads: number;

  /** Citation count (may be 0 if academia.edu doesn't expose it) */
  citations: number;

  /** ISO-8601 timestamp of the most recent metrics sync */
  lastSyncedAt: string;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Request/response DTOs
// ─────────────────────────────────────────────────────────────────────────────

/** Payload for POST /api/v1/papers */
export interface CreatePaperDto {
  title: string;
  abstract: string;
  coAuthors?: string[];
  tags?: string[];
  filePath?: string;
  content?: string;
  fileType?: 'pdf' | 'docx';
  sourceProposalId?: string;
}

/** Payload for PATCH /api/v1/papers/:id */
export interface UpdatePaperDto {
  title?: string;
  abstract?: string;
  coAuthors?: string[];
  tags?: string[];
  filePath?: string;
  content?: string;
  fileType?: 'pdf' | 'docx';
  status?: 'queued' | 'uploading' | 'uploaded' | 'failed';
  academiaUrl?: string;
}

/** Query params for GET /api/v1/papers */
export interface ListPapersFilters {
  status?: AbPaper['status'];
  sourceProposalId?: string;
  limit?: number;
  offset?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Upload workflow types
// ─────────────────────────────────────────────────────────────────────────────

/** Result of an upload attempt */
export interface UploadResult {
  success: boolean;
  uploadId: string;
  academiaUrl?: string;
  errorMessage?: string;
  retryCount: number;
}

/** Current session status for the browser automation session */
export interface SessionStatus {
  isAuthenticated: boolean;
  lastCheckedAt: string;
  email?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Metrics types
// ─────────────────────────────────────────────────────────────────────────────

/** Aggregate metrics across all uploaded papers */
export interface AggregateMetrics {
  totalPapers: number;
  totalViews: number;
  totalDownloads: number;
  totalCitations: number;
  lastSyncedAt: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Claim payload shapes (for entropy claim generation)
// ─────────────────────────────────────────────────────────────────────────────

/** Entropy claim for queuing a paper */
export interface QueueClaimPayload {
  paperId: string;
  title: string;
  domain: 'informational';
  deltaS: number;
}

/** Entropy claim for successfully uploading a paper (public knowledge event) */
export interface UploadClaimPayload {
  paperId: string;
  uploadId: string;
  title: string;
  academiaUrl: string;
  domains: ['informational', 'social'];
  /**
   * Entropy reduction: private knowledge → public knowledge
   * ΔS = log2(potential_audience) - log2(1)
   * A paper visible to ~10,000 researchers ≈ log2(10000) ≈ 13.29 bits
   */
  deltaS: number;
}

/** Entropy claim for reaching a view milestone */
export interface ViewMilestoneClaimPayload {
  paperId: string;
  title: string;
  academiaUrl: string;
  views: number;
  domain: 'social';
  deltaS: number;
}
