/**
 * ════════════════════════════════════════════════════════════════════════════════
 *  EXTROPY ENGINE — Academia Bridge | DatabaseService
 * ════════════════════════════════════════════════════════════════════════════════
 *
 *  PostgreSQL connection pool with automatic schema initialization.
 *  Tables are created on startup if they do not exist (idempotent).
 *
 *  Schema prefix: `academia` (matches DATABASE_URL ?schema=academia)
 *
 * ════════════════════════════════════════════════════════════════════════════════
 */

import pg from 'pg';

const { Pool } = pg;

/**
 * Wraps a `pg.Pool` with the academia-bridge schema initialization.
 * Call `initialize()` once at startup before using `query()`.
 */
export class DatabaseService {
  private pool: pg.Pool;

  /**
   * @param connectionString - Full PostgreSQL connection URI, including ?schema=academia
   */
  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString });
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  Public API
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Execute a parameterized SQL query.
   *
   * @param text   - SQL query string with $1, $2, ... placeholders
   * @param params - Parameter values
   * @returns pg.QueryResult
   */
  async query<T extends pg.QueryResultRow = pg.QueryResultRow>(
    text: string,
    params?: unknown[],
  ): Promise<pg.QueryResult<T>> {
    return this.pool.query<T>(text, params);
  }

  /**
   * Initialize the database schema.
   * Creates the `academia` schema and all tables if they do not yet exist.
   * This operation is fully idempotent (safe to call on every startup).
   */
  async initialize(): Promise<void> {
    await this.createSchema();
    await this.createTables();
    console.log('[academia-bridge] Database schema initialized');
  }

  /**
   * Gracefully close the connection pool.
   * Call during shutdown to allow in-flight queries to complete.
   */
  async close(): Promise<void> {
    await this.pool.end();
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  Private — schema initialization
  // ─────────────────────────────────────────────────────────────────────────

  /** Ensure the `academia` schema exists */
  private async createSchema(): Promise<void> {
    await this.pool.query(`CREATE SCHEMA IF NOT EXISTS academia`);
    await this.pool.query(`SET search_path TO academia, public`);
  }

  /** Create all tables in dependency order (papers → uploads → metrics) */
  private async createTables(): Promise<void> {
    // ── ab_papers ──────────────────────────────────────────────────────────
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS academia.ab_papers (
        id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        title               TEXT NOT NULL,
        abstract            TEXT NOT NULL DEFAULT '',
        co_authors          TEXT[]  NOT NULL DEFAULT '{}',
        tags                TEXT[]  NOT NULL DEFAULT '{}',
        file_path           TEXT,
        content             TEXT,
        file_type           TEXT NOT NULL DEFAULT 'pdf' CHECK (file_type IN ('pdf', 'docx')),
        status              TEXT NOT NULL DEFAULT 'queued'
                              CHECK (status IN ('queued', 'uploading', 'uploaded', 'failed')),
        academia_url        TEXT,
        source_proposal_id  TEXT,
        created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // ── ab_uploads ─────────────────────────────────────────────────────────
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS academia.ab_uploads (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        paper_id        UUID NOT NULL REFERENCES academia.ab_papers(id) ON DELETE CASCADE,
        status          TEXT NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending', 'in_progress', 'success', 'failed')),
        academia_url    TEXT,
        error_message   TEXT,
        retry_count     INTEGER NOT NULL DEFAULT 0,
        started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        completed_at    TIMESTAMPTZ
      )
    `);

    // ── ab_metrics ─────────────────────────────────────────────────────────
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS academia.ab_metrics (
        paper_id        UUID PRIMARY KEY REFERENCES academia.ab_papers(id) ON DELETE CASCADE,
        academia_url    TEXT NOT NULL,
        views           INTEGER NOT NULL DEFAULT 0,
        downloads       INTEGER NOT NULL DEFAULT 0,
        citations       INTEGER NOT NULL DEFAULT 0,
        last_synced_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // ── Indexes ────────────────────────────────────────────────────────────
    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS idx_ab_papers_status
        ON academia.ab_papers(status)
    `);
    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS idx_ab_papers_source_proposal
        ON academia.ab_papers(source_proposal_id)
        WHERE source_proposal_id IS NOT NULL
    `);
    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS idx_ab_uploads_paper_id
        ON academia.ab_uploads(paper_id)
    `);
    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS idx_ab_uploads_status
        ON academia.ab_uploads(status)
    `);

    // ── Auto-update trigger for updated_at ────────────────────────────────
    await this.pool.query(`
      CREATE OR REPLACE FUNCTION academia.update_updated_at_column()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW.updated_at = NOW();
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);

    await this.pool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_trigger
          WHERE tgname = 'trg_ab_papers_updated_at'
        ) THEN
          CREATE TRIGGER trg_ab_papers_updated_at
            BEFORE UPDATE ON academia.ab_papers
            FOR EACH ROW EXECUTE FUNCTION academia.update_updated_at_column();
        END IF;
      END;
      $$
    `);
  }
}
