/**
 * @module db
 * PostgreSQL client and audit log persistence for @extropy/ethics.
 *
 * Table: ethics_audit_log
 * Stores every ValidationResult produced by the ethics service,
 * enabling governance replay, compliance audits, and trend analytics.
 */
import { Pool, PoolClient } from 'pg';
import { ValidationResult } from './validator';
import { ActionContext } from './validator';

let pool: Pool | null = null;

/**
 * Return (or lazily create) the shared pg connection pool.
 * Reads DATABASE_URL from environment.
 */
export function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });
  }
  return pool;
}

/**
 * Run DDL to create the audit log table if it does not exist.
 * Safe to call on every service start-up.
 */
export async function initDb(): Promise<void> {
  const client: PoolClient = await getPool().connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS ethics_audit_log (
        id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        agent_id      TEXT        NOT NULL,
        action        TEXT        NOT NULL,
        metadata      JSONB,
        passed        BOOLEAN     NOT NULL,
        score         NUMERIC(5,3) NOT NULL,
        violations    JSONB       NOT NULL DEFAULT '[]',
        evaluated_at  TIMESTAMPTZ NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_audit_agent_id
        ON ethics_audit_log (agent_id);

      CREATE INDEX IF NOT EXISTS idx_audit_evaluated_at
        ON ethics_audit_log (evaluated_at DESC);
    `);
  } finally {
    client.release();
  }
}

export interface AuditRecord {
  id: string;
  agentId: string;
  action: string;
  metadata: Record<string, unknown> | null;
  passed: boolean;
  score: number;
  violations: unknown[];
  evaluatedAt: string;
}

/**
 * Persist a ValidationResult alongside the originating ActionContext.
 */
export async function insertAuditRecord(
  context: ActionContext,
  result: ValidationResult
): Promise<string> {
  const { rows } = await getPool().query<{ id: string }>(
    `INSERT INTO ethics_audit_log
      (agent_id, action, metadata, passed, score, violations, evaluated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id`,
    [
      context.agentId,
      context.action,
      context.metadata ?? null,
      result.passed,
      result.score,
      JSON.stringify(result.violations),
      result.evaluatedAt,
    ]
  );
  return rows[0].id;
}

/**
 * Retrieve recent audit records, optionally filtered by agentId.
 */
export async function queryAuditLog(
  limit = 50,
  agentId?: string
): Promise<AuditRecord[]> {
  const params: (string | number)[] = [limit];
  const where = agentId ? `WHERE agent_id = $2` : '';
  if (agentId) params.push(agentId);

  const { rows } = await getPool().query(
    `SELECT id, agent_id, action, metadata, passed, score, violations, evaluated_at
     FROM ethics_audit_log
     ${where}
     ORDER BY evaluated_at DESC
     LIMIT $1`,
    params
  );

  return rows.map((r) => ({
    id: r.id,
    agentId: r.agent_id,
    action: r.action,
    metadata: r.metadata,
    passed: r.passed,
    score: parseFloat(r.score),
    violations: r.violations,
    evaluatedAt: r.evaluated_at,
  }));
}

/** Gracefully close the pool (useful in tests / shutdown hooks). */
export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
