/**
 * ════════════════════════════════════════════════════════════════════════════════
 *  EXTROPY ENGINE — Epistemology Engine
 * ════════════════════════════════════════════════════════════════════════════════
 *
 *  v3.1 REDEFINITION NOTICE
 *  ─────────────────────────
 *  The epistemology engine is NOT a central decomposition service. The reading
 *  in v3.0 that placed claim decomposition here was a misunderstanding of what
 *  this layer always was. Decomposition is a personal-AI responsibility at the
 *  edge (see architecture/AUTARKY.md, docs/SPEC_v3.1.md §7).
 *
 *  In v3.1, the epistemology engine is recognized for what it is: the mesh's
 *  EMERGENT PEER-REVIEW SYSTEM, witnessed and aggregated as a queryable
 *  observability layer. The mesh, running on incentives alone, IS the engine.
 *  This package surfaces what emerges. It does not arbitrate truth.
 *
 *  WHAT THIS PACKAGE DOES (target state, v3.1.x → v3.2):
 *    1. Aggregates validation outcomes across the DAG
 *    2. Surfaces consensus drift, dissent clusters, contested-claim patterns
 *    3. Computes mesh-wide falsifiability statistics per domain/DFAO
 *    4. Tracks reputation graph evolution; flags Sybil-suspicious clusters
 *    5. Detects emergent ontologies (recurring claim patterns, naming drift)
 *    6. Provides queryable hooks for governance
 *    7. Surfaces Goodhart-pattern signals where XP correlates poorly with
 *       independently-observed outcomes
 *
 *  WHAT THIS PACKAGE DOES NOT DO:
 *    - Decompose claims (personal AI does this)
 *    - Decide what is true (the mesh does this through validation)
 *    - Hold a private world model
 *    - Act as a single source of epistemic authority
 *
 *  v3.0 LEGACY ENDPOINTS:
 *    The /claims POST + sub-claim atomization + Bayesian update endpoints below
 *    are retained for backwards compatibility through v3.1.x. They will be
 *    removed in v3.2 once observability endpoints are stable.
 *
 *  Architecture:
 *    - Express HTTP server (port 4001)
 *    - PostgreSQL database (mesh-state index, NOT a claim authority)
 *    - Redis for event bus subscription (read-mostly)
 *    - Shares @extropy/contracts types
 *    - Read-mostly: writes only metadata about network state
 *    - Stateless under restart: rebuilt from DAG replay
 *    - Multi-instance: no canonical engine instance, by design
 *
 * ════════════════════════════════════════════════════════════════════════════════
 */

import express, { Express, Request, Response, NextFunction } from 'express';
import { Pool } from 'pg';
import Redis from 'ioredis';
import { v4 as uuidv4 } from 'uuid';

import { ServiceName } from '@extropy/contracts';

import { aggregateLogOdds, aggregateGeometric } from './bayesian';

import {
  selectBackend,
  PostgresSource,
  DagSubstrateSource,
  type EpistemologySource,
} from './observability/index.js';
import { createMeshRouter } from './routes/mesh/index.js';
import { createLegacyRouter } from './routes/legacy/index.js';

// ─────────────────────────────────────────────────────────────────────────────
//  Configuration
// ─────────────────────────────────────────────────────────────────────────────

const PORT       = parseInt(process.env.PORT     ?? '3002', 10);
const DB_URL     = process.env.DATABASE_URL      ?? 'postgresql://postgres:postgres@localhost:5433/epistemology';
const REDIS_URL  = process.env.REDIS_URL         ?? 'redis://localhost:6379';

/** Truth score above which a fully-resolved claim is marked VERIFIED. */
const VERIFIED_THRESHOLD = parseFloat(process.env.VERIFIED_THRESHOLD ?? '0.6');

/** Aggregator: 'logodds' (v3.1, default) or 'geometric' (legacy v3.0 ∏ p^w). */
const AGGREGATOR = (process.env.TRUTH_AGGREGATOR ?? 'logodds') as 'logodds' | 'geometric';

function aggregateTruthScore(parts: ReadonlyArray<{ probability: number; weight: number }>): number {
  return AGGREGATOR === 'geometric' ? aggregateGeometric(parts) : aggregateLogOdds(parts);
}

// ─────────────────────────────────────────────────────────────────────────────
//  Database
// ─────────────────────────────────────────────────────────────────────────────

const db = new Pool({ connectionString: DB_URL });

async function initDb(): Promise<void> {
  await db.query(`
    CREATE TABLE IF NOT EXISTS claims (
      id             TEXT PRIMARY KEY,
      loop_id        TEXT NOT NULL,
      statement      TEXT NOT NULL,
      domain         TEXT NOT NULL,
      submitter_id   TEXT NOT NULL,
      status         TEXT NOT NULL DEFAULT 'submitted',
      bayesian_prior JSONB NOT NULL,
      sub_claim_ids  TEXT[] NOT NULL DEFAULT '{}',
      truth_score    FLOAT NOT NULL DEFAULT 0.5,
      created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      undecidable_reason TEXT
    );

    CREATE TABLE IF NOT EXISTS sub_claims (
      id                      TEXT PRIMARY KEY,
      claim_id                TEXT NOT NULL REFERENCES claims(id),
      loop_id                 TEXT NOT NULL,
      statement               TEXT NOT NULL,
      domain                  TEXT NOT NULL,
      status                  TEXT NOT NULL DEFAULT 'pending',
      bayesian_prior          JSONB NOT NULL,
      measurement_ids         TEXT[] NOT NULL DEFAULT '{}',
      assigned_validator_ids  TEXT[] NOT NULL DEFAULT '{}',
      weight                  FLOAT NOT NULL DEFAULT 1.0,
      depends_on              TEXT[] NOT NULL DEFAULT '{}',
      created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      resolved_at             TIMESTAMPTZ
    );

    CREATE INDEX IF NOT EXISTS idx_claims_loop_id   ON claims(loop_id);
    CREATE INDEX IF NOT EXISTS idx_claims_status    ON claims(status);
    CREATE INDEX IF NOT EXISTS idx_subclaims_claim  ON sub_claims(claim_id);
    CREATE INDEX IF NOT EXISTS idx_subclaims_loop   ON sub_claims(loop_id);
    CREATE INDEX IF NOT EXISTS idx_subclaims_status ON sub_claims(status);

    -- v3.1 observability: per-claim posterior history. Every truth_score
    -- transition appends a row. The mesh router computes drift, stability,
    -- and high-confidence-refutation counts from this table. Stateless under
    -- restart: rebuilt from DAG replay when the dag-substrate source ships.
    CREATE TABLE IF NOT EXISTS bayesian_history (
      id              BIGSERIAL PRIMARY KEY,
      claim_id        TEXT NOT NULL,
      domain          TEXT NOT NULL,
      previous_score  FLOAT,
      current_score   FLOAT NOT NULL,
      status          TEXT NOT NULL,
      observed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_bhist_claim     ON bayesian_history(claim_id, observed_at DESC);
    CREATE INDEX IF NOT EXISTS idx_bhist_domain_at ON bayesian_history(domain, observed_at DESC);
  `);
  console.log('[epistemology-engine] Database schema ready');
}

// ─────────────────────────────────────────────────────────────────────────────
//  Redis Event Bus
// ─────────────────────────────────────────────────────────────────────────────

const redis = new Redis(REDIS_URL);

interface SimpleEvent {
  eventId: string;
  aggregateId: string;
  type: string;
  data: unknown;
  occurredAt: string;
  source: string;
  schemaVersion: number;
}

async function publishEvent<T>(type: string, aggregateId: string, data: T): Promise<void> {
  const event: SimpleEvent = {
    eventId: uuidv4(),
    aggregateId,
    type,
    data,
    occurredAt: new Date().toISOString(),
    source: ServiceName.EPISTEMOLOGY_ENGINE,
    schemaVersion: 1,
  };
  await redis.publish('extropy:events', JSON.stringify(event));
}

// ─────────────────────────────────────────────────────────────────────────────
//  Bayesian Math — see ./bayesian.ts for the Beta(α, β) implementation
// ─────────────────────────────────────────────────────────────────────────────
//
//  v3.1: Bayesian math is now Beta(α, β) conjugate updates with proper Beta
//  credible intervals and weighted log-odds aggregation. Helpers live in
//  ./bayesian.ts so observability/test code can reuse them without dragging
//  in the express + pg + redis runtime.
//
// ─────────────────────────────────────────────────────────────────────────────
//  Claim Decomposition (LEGACY)
// ─────────────────────────────────────────────────────────────────────────────
//
//  The decomposeClaimToSubClaims and detectGodelBoundary helpers used to live
//  here. As of v3.1 they live in routes/legacy/index.ts alongside the v3.0
//  /claims and /sub-claims handlers, because that is the only call site.
//  Decomposition is a personal-AI responsibility at the edge in the v3.1
//  canonical flow (see architecture/AUTARKY.md, docs/SPEC_v3.1.md §7); the
//  legacy server-side rule-based decomposition stays only for v3.0
//  backwards compatibility through v3.1.x and gets removed in v3.2.
//
// ─────────────────────────────────────────────────────────────────────────────
//  This block intentionally left short. Helpers moved to routes/legacy.
//  Stub kept in case future v3.1.x tooling wants to assert the move.
//
// ─────────────────────────────────────────────────────────────────────────────

/* DECOMPOSITION_HELPERS_MOVED_TO=routes/legacy/index.ts */

// ─────────────────────────────────────────────────────────────────────────────
//  Express App
// ─────────────────────────────────────────────────────────────────────────────

// ── EpistemologySource backend selection (v3.1 observability) ────────────────
//
//  EPISTEMOLOGY_SOURCE=postgres        → PostgresSource (default, v3.1.x)
//  EPISTEMOLOGY_SOURCE=dag-substrate   → DagSubstrateSource (stub until DAG node API ships)
//
const epistemologyBackend = selectBackend();
const epistemologySource: EpistemologySource =
  epistemologyBackend === 'postgres'
    ? new PostgresSource({ pool: db })
    : new DagSubstrateSource();

const app: Express = express();
app.use(express.json());

// Mount the v3.1 observability surface under /mesh.
app.use('/mesh', createMeshRouter({ source: epistemologySource }));

// Mount the v3.0 backwards-compatible surface at the root. URLs do not change.
// Removed in v3.2 once the personal-AI decomposition path is canonical.
app.use(
  createLegacyRouter({
    db,
    publishEvent,
    verifiedThreshold: VERIFIED_THRESHOLD,
    aggregateTruthScore,
  }),
);

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/health', async (_req: Request, res: Response) => {
  try {
    await db.query('SELECT 1');
    res.json({ service: 'epistemology-engine', status: 'healthy', version: '1.0.0', uptime: process.uptime() });
  } catch (err) {
    res.status(503).json({ service: 'epistemology-engine', status: 'unhealthy', error: String(err) });
  }
});


// ── Error handler ─────────────────────────────────────────────────────────────
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[epistemology-engine] Error:', err);
  res.status(500).json({ error: err.message });
});

// ─────────────────────────────────────────────────────────────────────────────
//  Bootstrap
// ─────────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  await redis.ping();
  console.log('[epistemology-engine] Redis connected');

  await initDb();

  // Initialize the observability source before binding the listener.
  await epistemologySource.init();
  app.listen(PORT, () => {
    console.log(`[epistemology-engine] Listening on port ${PORT}`);
  });
}

main().catch(err => {
  console.error('[epistemology-engine] Fatal startup error:', err);
  process.exit(1);
});
