/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  GrantFlow Discovery — Database Service
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *  PostgreSQL connection pool wrapper for the grantflow-discovery service.
 *  Initializes tables on startup and provides a typed query interface.
 *
 *  Schema prefix: `gf_` for all GrantFlow tables.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from 'pg';

export class DatabaseService {
  private pool: Pool;

  constructor(connectionString: string) {
    this.pool = new Pool({
      connectionString,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  Core query interface
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Execute a parameterised SQL query against the pool.
   *
   * @param sql  - The SQL statement
   * @param params - Bound parameters array
   * @returns QueryResult rows
   */
  async query<T extends QueryResultRow = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<QueryResult<T>> {
    return this.pool.query<T>(sql, params);
  }

  /**
   * Acquire a client for transaction use.
   * Caller must call `client.release()` after use.
   */
  async getClient(): Promise<PoolClient> {
    return this.pool.connect();
  }

  /**
   * Execute a function inside a transaction. Automatically commits or
   * rolls back on error.
   */
  async transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  Initialisation
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Initialise all required tables.
   * Called once at service startup — idempotent (CREATE IF NOT EXISTS).
   */
  async initialize(): Promise<void> {
    await this.pool.query(`
      -- ── Researcher Profiles ──────────────────────────────────────────────
      CREATE TABLE IF NOT EXISTS gf_profiles (
        id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name              TEXT NOT NULL,
        email             TEXT,
        keywords          TEXT[]    NOT NULL DEFAULT '{}',
        domains           TEXT[]    NOT NULL DEFAULT '{}',
        past_awards       TEXT[]    NOT NULL DEFAULT '{}',
        expertise         TEXT[]    NOT NULL DEFAULT '{}',
        min_award_amount  NUMERIC,
        max_award_amount  NUMERIC,
        eligibility_types TEXT[]    NOT NULL DEFAULT '{}',
        created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      -- ── Grant Opportunities ───────────────────────────────────────────────
      CREATE TABLE IF NOT EXISTS gf_opportunities (
        id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        opp_number       TEXT NOT NULL UNIQUE,
        title            TEXT NOT NULL,
        agency           TEXT NOT NULL,
        agency_code      TEXT,
        description      TEXT NOT NULL DEFAULT '',
        award_ceiling    NUMERIC,
        award_floor      NUMERIC,
        expected_awards  INT,
        open_date        DATE,
        close_date       DATE,
        category         TEXT,
        funding_instrument TEXT,
        eligibility      TEXT[]    NOT NULL DEFAULT '{}',
        cfda_numbers     TEXT[]    NOT NULL DEFAULT '{}',
        status           TEXT      NOT NULL DEFAULT 'posted',
        raw_data         JSONB     NOT NULL DEFAULT '{}',
        discovered_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_gf_opportunities_status ON gf_opportunities(status);
      CREATE INDEX IF NOT EXISTS idx_gf_opportunities_close_date ON gf_opportunities(close_date);
      CREATE INDEX IF NOT EXISTS idx_gf_opportunities_discovered_at ON gf_opportunities(discovered_at DESC);

      -- ── Grant-Profile Matches ─────────────────────────────────────────────
      CREATE TABLE IF NOT EXISTS gf_matches (
        id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        opportunity_id   UUID NOT NULL REFERENCES gf_opportunities(id) ON DELETE CASCADE,
        profile_id       UUID NOT NULL REFERENCES gf_profiles(id)      ON DELETE CASCADE,
        score            NUMERIC(5,2) NOT NULL DEFAULT 0,
        match_reasons    TEXT[]   NOT NULL DEFAULT '{}',
        keyword_matches  TEXT[]   NOT NULL DEFAULT '{}',
        domain_matches   TEXT[]   NOT NULL DEFAULT '{}',
        award_amount_fit BOOLEAN  NOT NULL DEFAULT FALSE,
        created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(opportunity_id, profile_id)
      );

      CREATE INDEX IF NOT EXISTS idx_gf_matches_profile_id ON gf_matches(profile_id);
      CREATE INDEX IF NOT EXISTS idx_gf_matches_score ON gf_matches(score DESC);

      -- ── Submission Pipeline ───────────────────────────────────────────────
      CREATE TABLE IF NOT EXISTS gf_submissions (
        id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        opportunity_id              UUID NOT NULL REFERENCES gf_opportunities(id) ON DELETE CASCADE,
        profile_id                  UUID NOT NULL REFERENCES gf_profiles(id)      ON DELETE CASCADE,
        proposal_id                 TEXT,
        status                      TEXT NOT NULL DEFAULT 'discovered',
        status_history              JSONB NOT NULL DEFAULT '[]',
        s2s_package_xml             TEXT,
        submitted_at                TIMESTAMPTZ,
        grants_gov_tracking_number  TEXT,
        notes                       TEXT,
        created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_gf_submissions_profile_id ON gf_submissions(profile_id);
      CREATE INDEX IF NOT EXISTS idx_gf_submissions_status ON gf_submissions(status);

      -- ── Search Run Log ────────────────────────────────────────────────────
      CREATE TABLE IF NOT EXISTS gf_search_runs (
        id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        query          TEXT NOT NULL,
        results_count  INT  NOT NULL DEFAULT 0,
        matches_found  INT  NOT NULL DEFAULT 0,
        claims_emitted INT  NOT NULL DEFAULT 0,
        success        BOOLEAN NOT NULL DEFAULT TRUE,
        error_message  TEXT,
        duration_ms    INT  NOT NULL DEFAULT 0,
        executed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_gf_search_runs_executed_at ON gf_search_runs(executed_at DESC);

      -- ── Claim Records ─────────────────────────────────────────────────────
      CREATE TABLE IF NOT EXISTS gf_claim_records (
        id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        claim_id       TEXT NOT NULL,
        loop_id        TEXT NOT NULL,
        claim_type     TEXT NOT NULL,
        status         TEXT NOT NULL DEFAULT 'pending',
        opportunity_id UUID REFERENCES gf_opportunities(id) ON DELETE SET NULL,
        profile_id     UUID REFERENCES gf_profiles(id)      ON DELETE SET NULL,
        submission_id  UUID REFERENCES gf_submissions(id)   ON DELETE SET NULL,
        xp_minted      NUMERIC,
        created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_gf_claim_records_loop_id ON gf_claim_records(loop_id);
      CREATE INDEX IF NOT EXISTS idx_gf_claim_records_claim_id ON gf_claim_records(claim_id);
    `);

    console.log('[grantflow-discovery] All database tables verified');
  }

  /**
   * Gracefully close the connection pool.
   */
  async close(): Promise<void> {
    await this.pool.end();
  }
}
