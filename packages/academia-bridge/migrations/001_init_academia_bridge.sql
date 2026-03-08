-- ════════════════════════════════════════════════════════════════════════════════
--  EXTROPY ENGINE — Academia Bridge | Initial Migration
--  Migration: 001_init_academia_bridge.sql
--  Service:   academia-bridge (port 4022)
--  Schema:    academia
-- ════════════════════════════════════════════════════════════════════════════════
--
--  Creates:
--    - academia schema
--    - ab_papers  — paper upload queue
--    - ab_uploads — upload execution log
--    - ab_metrics — view/download performance cache
--    - Indexes and triggers
--
--  This migration is idempotent (safe to run multiple times).
-- ════════════════════════════════════════════════════════════════════════════════

-- ── Schema ────────────────────────────────────────────────────────────────────
CREATE SCHEMA IF NOT EXISTS academia;

-- ── Extension ─────────────────────────────────────────────────────────────────
-- gen_random_uuid() is available in PostgreSQL 13+ without extension.
-- For earlier versions, enable pgcrypto:
-- CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── ab_papers ─────────────────────────────────────────────────────────────────
--
--  Core queue table. One row per paper. Papers move through a state machine:
--    queued → uploading → uploaded
--                       ↘ failed (retryable)
--
CREATE TABLE IF NOT EXISTS academia.ab_papers (
  -- Primary key
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Paper metadata
  title               TEXT        NOT NULL
                        CHECK (char_length(title) >= 1 AND char_length(title) <= 500),
  abstract            TEXT        NOT NULL DEFAULT '',
  co_authors          TEXT[]      NOT NULL DEFAULT '{}',
  tags                TEXT[]      NOT NULL DEFAULT '{}',

  -- File source — one of these must be non-null
  file_path           TEXT,
  content             TEXT,
  file_type           TEXT        NOT NULL DEFAULT 'pdf'
                        CHECK (file_type IN ('pdf', 'docx')),

  -- Lifecycle
  status              TEXT        NOT NULL DEFAULT 'queued'
                        CHECK (status IN ('queued', 'uploading', 'uploaded', 'failed')),
  academia_url        TEXT,

  -- Cross-service linkage
  source_proposal_id  TEXT,        -- links to grantflow-proposer gf_proposals.id

  -- Audit
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Validation: must have either a file path or content
  CONSTRAINT ab_papers_file_source_check
    CHECK (file_path IS NOT NULL OR content IS NOT NULL)
);

COMMENT ON TABLE  academia.ab_papers IS 'Papers queued for upload to academia.edu';
COMMENT ON COLUMN academia.ab_papers.file_path  IS 'Absolute path to existing PDF/DOCX on disk';
COMMENT ON COLUMN academia.ab_papers.content    IS 'Raw text content to write to temp file before upload';
COMMENT ON COLUMN academia.ab_papers.status     IS 'queued | uploading | uploaded | failed';
COMMENT ON COLUMN academia.ab_papers.academia_url IS 'Canonical academia.edu URL, populated on successful upload';
COMMENT ON COLUMN academia.ab_papers.source_proposal_id IS 'Back-reference to originating grantflow-proposer proposal';

-- ── ab_uploads ────────────────────────────────────────────────────────────────
--
--  Upload execution log. One row per upload attempt.
--  Multiple rows can exist per paper (retries + manual re-triggers).
--
CREATE TABLE IF NOT EXISTS academia.ab_uploads (
  -- Primary key
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Relationship
  paper_id        UUID        NOT NULL
                    REFERENCES academia.ab_papers(id)
                    ON DELETE CASCADE,

  -- Execution
  status          TEXT        NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'in_progress', 'success', 'failed')),
  academia_url    TEXT,
  error_message   TEXT,
  retry_count     INTEGER     NOT NULL DEFAULT 0
                    CHECK (retry_count >= 0 AND retry_count <= 10),

  -- Timing
  started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at    TIMESTAMPTZ
);

COMMENT ON TABLE  academia.ab_uploads IS 'Upload attempt log for academia.edu automated uploads';
COMMENT ON COLUMN academia.ab_uploads.status       IS 'pending | in_progress | success | failed';
COMMENT ON COLUMN academia.ab_uploads.academia_url IS 'Public URL captured after successful upload';
COMMENT ON COLUMN academia.ab_uploads.error_message IS 'Detailed error for debugging failed uploads';
COMMENT ON COLUMN academia.ab_uploads.retry_count  IS 'Number of retry attempts (max 3 per upload cycle)';

-- ── ab_metrics ────────────────────────────────────────────────────────────────
--
--  Cached view/download performance metrics.
--  One row per uploaded paper (upserted on each sync).
--
CREATE TABLE IF NOT EXISTS academia.ab_metrics (
  -- Primary key is the paper ID (one row per paper)
  paper_id        UUID        PRIMARY KEY
                    REFERENCES academia.ab_papers(id)
                    ON DELETE CASCADE,

  -- Source
  academia_url    TEXT        NOT NULL,

  -- Metrics
  views           INTEGER     NOT NULL DEFAULT 0 CHECK (views >= 0),
  downloads       INTEGER     NOT NULL DEFAULT 0 CHECK (downloads >= 0),
  citations       INTEGER     NOT NULL DEFAULT 0 CHECK (citations >= 0),

  -- Freshness
  last_synced_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  academia.ab_metrics IS 'Cached view/download/citation metrics from academia.edu';
COMMENT ON COLUMN academia.ab_metrics.views       IS 'Total page views as reported by academia.edu';
COMMENT ON COLUMN academia.ab_metrics.downloads   IS 'Total download count';
COMMENT ON COLUMN academia.ab_metrics.citations   IS 'Citation count (0 if not available)';
COMMENT ON COLUMN academia.ab_metrics.last_synced_at IS 'When metrics were last scraped from academia.edu';

-- ── Indexes ───────────────────────────────────────────────────────────────────

-- Fast lookups by status (e.g., "get all queued papers")
CREATE INDEX IF NOT EXISTS idx_ab_papers_status
  ON academia.ab_papers(status);

-- Fast lookups by source proposal (for grantflow-proposer integration)
CREATE INDEX IF NOT EXISTS idx_ab_papers_source_proposal
  ON academia.ab_papers(source_proposal_id)
  WHERE source_proposal_id IS NOT NULL;

-- All uploads for a paper (chronological)
CREATE INDEX IF NOT EXISTS idx_ab_uploads_paper_id_started
  ON academia.ab_uploads(paper_id, started_at DESC);

-- Failed uploads that might need attention
CREATE INDEX IF NOT EXISTS idx_ab_uploads_failed
  ON academia.ab_uploads(status, started_at DESC)
  WHERE status = 'failed';

-- Papers with high view counts (for leaderboard queries)
CREATE INDEX IF NOT EXISTS idx_ab_metrics_views
  ON academia.ab_metrics(views DESC)
  WHERE views > 0;

-- ── Auto-update trigger for updated_at ───────────────────────────────────────

CREATE OR REPLACE FUNCTION academia.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop existing trigger to allow idempotent re-creation
DROP TRIGGER IF EXISTS trg_ab_papers_updated_at ON academia.ab_papers;

CREATE TRIGGER trg_ab_papers_updated_at
  BEFORE UPDATE ON academia.ab_papers
  FOR EACH ROW
  EXECUTE FUNCTION academia.update_updated_at_column();

-- ── Seed: default view milestone thresholds (reference data) ─────────────────
-- These are not stored in the database — they are constants in metrics.routes.ts.
-- Documented here for reference:
--
--   100, 500, 1_000, 5_000, 10_000, 50_000, 100_000 views
--
-- Each milestone crossing emits an Extropy Engine claim (SOCIAL domain).

-- ── Done ─────────────────────────────────────────────────────────────────────
-- Migration 001_init_academia_bridge.sql applied successfully.
