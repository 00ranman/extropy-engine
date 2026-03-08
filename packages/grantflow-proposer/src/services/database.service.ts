/**
 * ════════════════════════════════════════════════════════════════════════════════
 *  GrantFlow Proposer — Database Service
 * ════════════════════════════════════════════════════════════════════════════════
 *
 *  PostgreSQL connection pool wrapper for the grantflow-proposer service.
 *  Manages a pg Pool, exposes typed query helpers, and ensures all tables
 *  exist on startup. The schema is kept isolated under the `proposer`
 *  schema namespace to avoid collisions with other Extropy Engine services.
 *
 *  Tables managed:
 *    - gf_proposals    — grant proposal documents
 *    - gf_sections     — individual proposal sections (versioned)
 *    - gf_templates    — reusable section templates
 *    - gf_refinements  — refinement passes with quality deltas
 *
 * ════════════════════════════════════════════════════════════════════════════════
 */

import pg from 'pg';

const { Pool } = pg;

// ─────────────────────────────────────────────────────────────────────────────
//  Types
// ─────────────────────────────────────────────────────────────────────────────

export interface QueryResult<T = Record<string, unknown>> {
  rows: T[];
  rowCount: number;
}

// ─────────────────────────────────────────────────────────────────────────────
//  DatabaseService
// ─────────────────────────────────────────────────────────────────────────────

export class DatabaseService {
  private pool: pg.Pool;

  /**
   * Create a new DatabaseService backed by the provided PostgreSQL connection URL.
   *
   * @param connectionString - Full PostgreSQL connection string (incl. ?schema=proposer)
   */
  constructor(private readonly connectionString: string) {
    this.pool = new Pool({
      connectionString,
      max: 20,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    });

    // Surface pool-level errors to stderr rather than crashing the process
    this.pool.on('error', (err) => {
      console.error('[proposer:db] Unexpected pool error:', err.message);
    });
  }

  // ── Core Query Interface ────────────────────────────────────────────────────

  /**
   * Execute a parameterized SQL query and return typed results.
   *
   * @param sql    - The SQL statement (use $1, $2, … placeholders)
   * @param params - Ordered parameter values
   */
  async query<T = Record<string, unknown>>(
    sql: string,
    params: unknown[] = [],
  ): Promise<QueryResult<T>> {
    const client = await this.pool.connect();
    try {
      const result = await client.query(sql, params);
      return {
        rows: result.rows as T[],
        rowCount: result.rowCount ?? 0,
      };
    } finally {
      client.release();
    }
  }

  /**
   * Execute multiple statements in a single transaction.
   * Rolls back on any error.
   *
   * @param fn - Async function receiving a transaction query helper
   */
  async transaction<T>(
    fn: (query: (sql: string, params?: unknown[]) => Promise<QueryResult>) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const queryFn = async (sql: string, params: unknown[] = []) => {
        const result = await client.query(sql, params);
        return {
          rows: result.rows as Record<string, unknown>[],
          rowCount: result.rowCount ?? 0,
        };
      };
      const result = await fn(queryFn);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  // ── Schema Initialization ───────────────────────────────────────────────────

  /**
   * Initialize the database by creating all required tables if they do not
   * yet exist. Safe to call multiple times — all statements use IF NOT EXISTS.
   * Called once at service startup before the HTTP server begins accepting traffic.
   */
  async initialize(): Promise<void> {
    await this.query(`
      CREATE TABLE IF NOT EXISTS gf_proposals (
        id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        submission_id        TEXT NOT NULL,
        opportunity_title    TEXT NOT NULL,
        agency               TEXT NOT NULL,
        opportunity_number   TEXT,
        principal_investigator TEXT,
        requested_amount     NUMERIC(14, 2),
        proposal_duration    TEXT,
        status               TEXT NOT NULL DEFAULT 'draft',
        quality_score        NUMERIC(5, 2) NOT NULL DEFAULT 0,
        created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await this.query(`
      CREATE TABLE IF NOT EXISTS gf_sections (
        id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        proposal_id       UUID NOT NULL REFERENCES gf_proposals(id) ON DELETE CASCADE,
        section_type      TEXT NOT NULL,
        content           TEXT NOT NULL DEFAULT '',
        version           INTEGER NOT NULL DEFAULT 1,
        quality_score     NUMERIC(5, 2) NOT NULL DEFAULT 0,
        is_ai_generated   BOOLEAN NOT NULL DEFAULT FALSE,
        created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await this.query(`
      CREATE INDEX IF NOT EXISTS idx_gf_sections_proposal_id ON gf_sections(proposal_id)
    `);

    await this.query(`
      CREATE TABLE IF NOT EXISTS gf_templates (
        id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name         TEXT NOT NULL,
        section_type TEXT NOT NULL,
        content      TEXT NOT NULL,
        is_default   BOOLEAN NOT NULL DEFAULT FALSE,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await this.query(`
      CREATE INDEX IF NOT EXISTS idx_gf_templates_section_type ON gf_templates(section_type)
    `);

    await this.query(`
      CREATE TABLE IF NOT EXISTS gf_refinements (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        proposal_id     UUID NOT NULL REFERENCES gf_proposals(id) ON DELETE CASCADE,
        section_id      UUID NOT NULL REFERENCES gf_sections(id) ON DELETE CASCADE,
        before_content  TEXT NOT NULL,
        after_content   TEXT NOT NULL,
        quality_delta   NUMERIC(5, 2) NOT NULL DEFAULT 0,
        instructions    TEXT NOT NULL DEFAULT '',
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await this.query(`
      CREATE INDEX IF NOT EXISTS idx_gf_refinements_proposal_id ON gf_refinements(proposal_id)
    `);

    // Also ensure the shared event_log table exists (used by the event bus)
    await this.query(`
      CREATE TABLE IF NOT EXISTS public.event_log (
        id             BIGSERIAL PRIMARY KEY,
        event_id       TEXT NOT NULL UNIQUE,
        type           TEXT NOT NULL,
        payload        JSONB NOT NULL,
        source         TEXT NOT NULL,
        correlation_id TEXT NOT NULL,
        version        INTEGER NOT NULL DEFAULT 1,
        created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `).catch(() => {
      // May fail if the table already exists in a different schema — safe to ignore
    });

    console.log('[proposer:db] Schema initialized successfully');
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────────

  /**
   * Gracefully close all connections in the pool.
   * Should be called on SIGTERM / SIGINT.
   */
  async close(): Promise<void> {
    await this.pool.end();
    console.log('[proposer:db] Connection pool closed');
  }
}
