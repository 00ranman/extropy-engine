/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  HomeFlow — Database Service
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  PostgreSQL connection pool and schema initialization for HomeFlow.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { Pool, type PoolClient } from 'pg';

export class DatabaseService {
  public pool: Pool;

  constructor(databaseUrl: string) {
    this.pool = new Pool({ connectionString: databaseUrl });
  }

  async initialize(): Promise<void> {
    await this.pool.query(SCHEMA_SQL);
    console.log('[homeflow:db] Schema initialized');
  }

  async query(text: string, params?: unknown[]) {
    return this.pool.query(text, params);
  }

  async getClient(): Promise<PoolClient> {
    return this.pool.connect();
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Schema DDL
// ─────────────────────────────────────────────────────────────────────────────

const SCHEMA_SQL = `
-- ═══════════════════════════════════════════════════════════════════
--  HomeFlow Database Schema
-- ═══════════════════════════════════════════════════════════════════

-- Households
CREATE TABLE IF NOT EXISTS hf_households (
  id                   TEXT PRIMARY KEY,
  name                 TEXT NOT NULL,
  dfao_id              TEXT,
  validator_id         TEXT NOT NULL,
  member_validator_ids TEXT[] NOT NULL DEFAULT '{}',
  address              TEXT,
  timezone             TEXT NOT NULL DEFAULT 'America/Chicago',
  area_sqft            INTEGER,
  zone_ids             TEXT[] NOT NULL DEFAULT '{}',
  energy_baseline_kwh  FLOAT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Zones
CREATE TABLE IF NOT EXISTS hf_zones (
  id                    TEXT PRIMARY KEY,
  household_id          TEXT NOT NULL REFERENCES hf_households(id) ON DELETE CASCADE,
  name                  TEXT NOT NULL,
  floor                 INTEGER NOT NULL DEFAULT 1,
  area_sqft             INTEGER NOT NULL DEFAULT 0,
  device_ids            TEXT[] NOT NULL DEFAULT '{}',
  target_temperature_f  FLOAT,
  target_humidity_pct   FLOAT,
  is_occupied           BOOLEAN NOT NULL DEFAULT false,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Devices
CREATE TABLE IF NOT EXISTS hf_devices (
  id                TEXT PRIMARY KEY,
  household_id      TEXT NOT NULL REFERENCES hf_households(id) ON DELETE CASCADE,
  zone_id           TEXT REFERENCES hf_zones(id) ON DELETE SET NULL,
  name              TEXT NOT NULL,
  type              TEXT NOT NULL,
  manufacturer      TEXT NOT NULL DEFAULT 'unknown',
  model             TEXT NOT NULL DEFAULT 'unknown',
  firmware_version  TEXT NOT NULL DEFAULT '0.0.0',
  status            TEXT NOT NULL DEFAULT 'online',
  capabilities      JSONB NOT NULL DEFAULT '[]',
  state             JSONB NOT NULL DEFAULT '{}',
  metadata          JSONB NOT NULL DEFAULT '{}',
  last_seen_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Device Commands
CREATE TABLE IF NOT EXISTS hf_commands (
  id              TEXT PRIMARY KEY,
  device_id       TEXT NOT NULL REFERENCES hf_devices(id) ON DELETE CASCADE,
  type            TEXT NOT NULL,
  parameters      JSONB NOT NULL DEFAULT '{}',
  status          TEXT NOT NULL DEFAULT 'pending',
  issued_by       TEXT NOT NULL,
  issued_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  confirmed_at    TIMESTAMPTZ,
  previous_state  JSONB NOT NULL DEFAULT '{}',
  new_state       JSONB NOT NULL DEFAULT '{}'
);

-- Automation Schedules
CREATE TABLE IF NOT EXISTS hf_schedules (
  id                TEXT PRIMARY KEY,
  household_id      TEXT NOT NULL REFERENCES hf_households(id) ON DELETE CASCADE,
  name              TEXT NOT NULL,
  type              TEXT NOT NULL,
  enabled           BOOLEAN NOT NULL DEFAULT true,
  cron_expression   TEXT,
  season_id         TEXT,
  conditions        JSONB NOT NULL DEFAULT '[]',
  actions           JSONB NOT NULL DEFAULT '[]',
  cumulative_delta_s FLOAT NOT NULL DEFAULT 0,
  last_triggered_at TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Entropy Snapshots
CREATE TABLE IF NOT EXISTS hf_entropy_snapshots (
  id                     SERIAL PRIMARY KEY,
  household_id           TEXT NOT NULL REFERENCES hf_households(id) ON DELETE CASCADE,
  timestamp              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  total_power_watts      FLOAT NOT NULL DEFAULT 0,
  energy_consumed_wh     FLOAT NOT NULL DEFAULT 0,
  avg_indoor_temp_f      FLOAT,
  outdoor_temp_f         FLOAT,
  avg_humidity_pct       FLOAT,
  solar_generated_wh     FLOAT NOT NULL DEFAULT 0,
  occupied_zones         INTEGER NOT NULL DEFAULT 0,
  total_zones            INTEGER NOT NULL DEFAULT 0,
  entropy_joule_per_kelvin FLOAT NOT NULL DEFAULT 0
);

-- Entropy Reductions (closed measurement pairs)
CREATE TABLE IF NOT EXISTS hf_entropy_reductions (
  id                TEXT PRIMARY KEY,
  household_id      TEXT NOT NULL REFERENCES hf_households(id) ON DELETE CASCADE,
  loop_id           TEXT,
  claim_id          TEXT,
  before_snapshot_id INTEGER REFERENCES hf_entropy_snapshots(id),
  after_snapshot_id  INTEGER REFERENCES hf_entropy_snapshots(id),
  delta_s           FLOAT NOT NULL,
  breakdown         JSONB NOT NULL DEFAULT '{}',
  causal_command_ids TEXT[] NOT NULL DEFAULT '{}',
  confidence        FLOAT NOT NULL DEFAULT 0.8,
  measured_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- HomeFlow Claims (local tracking; canonical data lives in Epistemology Engine)
CREATE TABLE IF NOT EXISTS hf_claims (
  id              TEXT PRIMARY KEY,
  household_id    TEXT NOT NULL REFERENCES hf_households(id) ON DELETE CASCADE,
  loop_id         TEXT NOT NULL,
  claim_id        TEXT NOT NULL,
  delta_s         FLOAT NOT NULL,
  statement       TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'submitted',
  xp_earned       FLOAT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Validation Tasks (tasks routed to HomeFlow by SignalFlow)
CREATE TABLE IF NOT EXISTS hf_validation_tasks (
  id                TEXT PRIMARY KEY,
  task_id           TEXT NOT NULL,
  claim_id          TEXT NOT NULL,
  loop_id           TEXT NOT NULL,
  from_service      TEXT NOT NULL,
  entropy_domain    TEXT NOT NULL,
  verdict           TEXT,
  confidence        FLOAT,
  justification     TEXT,
  assigned_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at      TIMESTAMPTZ
);

-- Token Flows (HomeFlow-specific: energy credits, household CT)
CREATE TABLE IF NOT EXISTS hf_token_flows (
  id              TEXT PRIMARY KEY,
  household_id    TEXT NOT NULL REFERENCES hf_households(id) ON DELETE CASCADE,
  validator_id    TEXT NOT NULL,
  token_type      TEXT NOT NULL,
  amount          FLOAT NOT NULL,
  loop_id         TEXT,
  reason          TEXT NOT NULL,
  vertex_id       TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Credentials (HomeFlow-issued efficiency certs)
CREATE TABLE IF NOT EXISTS hf_credentials (
  id                TEXT PRIMARY KEY,
  household_id      TEXT NOT NULL REFERENCES hf_households(id) ON DELETE CASCADE,
  validator_id      TEXT NOT NULL,
  credential_id     TEXT NOT NULL,
  level             TEXT NOT NULL,
  cumulative_delta_s FLOAT NOT NULL DEFAULT 0,
  issued_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Cross-domain aggregations
CREATE TABLE IF NOT EXISTS hf_cross_domain_aggregations (
  id              TEXT PRIMARY KEY,
  household_id    TEXT NOT NULL REFERENCES hf_households(id) ON DELETE CASCADE,
  source_app      TEXT NOT NULL,
  source_domain   TEXT NOT NULL,
  source_delta_s  FLOAT NOT NULL,
  homeflow_delta_s FLOAT NOT NULL,
  composite_delta_s FLOAT NOT NULL,
  composite_xp    FLOAT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- DAG references (HomeFlow vertices recorded in DAG substrate)
CREATE TABLE IF NOT EXISTS hf_dag_references (
  id              TEXT PRIMARY KEY,
  vertex_id       TEXT NOT NULL,
  vertex_type     TEXT NOT NULL,
  household_id    TEXT NOT NULL REFERENCES hf_households(id) ON DELETE CASCADE,
  related_entity  TEXT NOT NULL,
  entity_type     TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_hf_devices_household   ON hf_devices(household_id);
CREATE INDEX IF NOT EXISTS idx_hf_devices_zone        ON hf_devices(zone_id);
CREATE INDEX IF NOT EXISTS idx_hf_devices_type        ON hf_devices(type);
CREATE INDEX IF NOT EXISTS idx_hf_devices_status      ON hf_devices(status);
CREATE INDEX IF NOT EXISTS idx_hf_commands_device     ON hf_commands(device_id);
CREATE INDEX IF NOT EXISTS idx_hf_commands_status     ON hf_commands(status);
CREATE INDEX IF NOT EXISTS idx_hf_snapshots_household ON hf_entropy_snapshots(household_id);
CREATE INDEX IF NOT EXISTS idx_hf_snapshots_time      ON hf_entropy_snapshots(timestamp);
CREATE INDEX IF NOT EXISTS idx_hf_reductions_household ON hf_entropy_reductions(household_id);
CREATE INDEX IF NOT EXISTS idx_hf_reductions_loop     ON hf_entropy_reductions(loop_id);
CREATE INDEX IF NOT EXISTS idx_hf_claims_household    ON hf_claims(household_id);
CREATE INDEX IF NOT EXISTS idx_hf_claims_loop         ON hf_claims(loop_id);
CREATE INDEX IF NOT EXISTS idx_hf_schedules_household ON hf_schedules(household_id);
CREATE INDEX IF NOT EXISTS idx_hf_zones_household     ON hf_zones(household_id);
CREATE INDEX IF NOT EXISTS idx_hf_token_flows_household ON hf_token_flows(household_id);
CREATE INDEX IF NOT EXISTS idx_hf_dag_refs_household  ON hf_dag_references(household_id);
CREATE INDEX IF NOT EXISTS idx_hf_dag_refs_vertex     ON hf_dag_references(vertex_id);
`;
