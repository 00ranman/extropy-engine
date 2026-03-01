-- ═════════════════════════════════════════════════════════════════════════════
-- Extropy Engine — Database Initialisation
-- ═════════════════════════════════════════════════════════════════════════════
-- Run once against a fresh PostgreSQL instance.
-- Idempotent: all statements use IF NOT EXISTS / ON CONFLICT DO NOTHING.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Extensions ────────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ══════════════════════════════════════════════════════════════════════════════
-- Schema: epistemology
-- ══════════════════════════════════════════════════════════════════════════════
CREATE SCHEMA IF NOT EXISTS epistemology;

CREATE TABLE IF NOT EXISTS epistemology.claims (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content       TEXT        NOT NULL,
  domain        TEXT        NOT NULL,
  submitter_id  TEXT        NOT NULL,
  status        TEXT        NOT NULL DEFAULT 'pending',
  entropy_score NUMERIC(10,4),
  confidence    NUMERIC(5,4),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS epistemology.verdicts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id    UUID        NOT NULL REFERENCES epistemology.claims(id),
  validator_id TEXT       NOT NULL,
  verdict     TEXT        NOT NULL,
  confidence  NUMERIC(5,4),
  reasoning   TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ══════════════════════════════════════════════════════════════════════════════
-- Schema: signalflow
-- ══════════════════════════════════════════════════════════════════════════════
CREATE SCHEMA IF NOT EXISTS signalflow;

CREATE TABLE IF NOT EXISTS signalflow.routing_decisions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id      UUID        NOT NULL,
  validator_ids TEXT[]      NOT NULL DEFAULT '{}',
  domain        TEXT        NOT NULL,
  strategy      TEXT        NOT NULL DEFAULT 'reputation_weighted',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ══════════════════════════════════════════════════════════════════════════════
-- Schema: ledger
-- ══════════════════════════════════════════════════════════════════════════════
CREATE SCHEMA IF NOT EXISTS ledger;

CREATE TABLE IF NOT EXISTS ledger.loops (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id      UUID        NOT NULL,
  domain        TEXT        NOT NULL,
  status        TEXT        NOT NULL DEFAULT 'open',
  validator_ids TEXT[]      NOT NULL DEFAULT '{}',
  delta_s       NUMERIC(10,6) DEFAULT 0,
  opened_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at     TIMESTAMPTZ,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ══════════════════════════════════════════════════════════════════════════════
-- Schema: xp
-- ══════════════════════════════════════════════════════════════════════════════
CREATE SCHEMA IF NOT EXISTS xp;

CREATE TABLE IF NOT EXISTS xp.ledger (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  validator_id     TEXT        NOT NULL,
  loop_id          UUID        NOT NULL,
  domain           TEXT        NOT NULL,
  delta_s          NUMERIC(10,6) NOT NULL,
  reputation       NUMERIC(10,6) NOT NULL,
  domain_difficulty NUMERIC(5,4) NOT NULL DEFAULT 1.0,
  xp_minted        NUMERIC(12,6) NOT NULL,
  minted_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_xp_ledger_validator ON xp.ledger(validator_id);
CREATE INDEX IF NOT EXISTS idx_xp_ledger_loop ON xp.ledger(loop_id);

-- ══════════════════════════════════════════════════════════════════════════════
-- Schema: reputation
-- ══════════════════════════════════════════════════════════════════════════════
CREATE SCHEMA IF NOT EXISTS reputation;

CREATE TABLE IF NOT EXISTS reputation.validators (
  id                   TEXT        PRIMARY KEY,
  name                 TEXT        NOT NULL,
  type                 TEXT        NOT NULL DEFAULT 'human',
  domains              TEXT[]      NOT NULL DEFAULT '{}',
  aggregate_reputation NUMERIC(10,6) NOT NULL DEFAULT 1.0,
  reputation_by_domain JSONB       NOT NULL DEFAULT '{}',
  accrual_rate         NUMERIC(5,4) NOT NULL DEFAULT 0.1,
  decay_rate           NUMERIC(5,4) NOT NULL DEFAULT 0.02,
  current_streak       INTEGER     NOT NULL DEFAULT 0,
  penalty_count        INTEGER     NOT NULL DEFAULT 0,
  total_xp_earned      NUMERIC(12,6) NOT NULL DEFAULT 0,
  loops_participated   INTEGER     NOT NULL DEFAULT 0,
  accurate_validations INTEGER     NOT NULL DEFAULT 0,
  current_task_count   INTEGER     NOT NULL DEFAULT 0,
  max_concurrent_tasks INTEGER     NOT NULL DEFAULT 5,
  is_active            BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_active_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS reputation.events (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  validator_id     TEXT        NOT NULL REFERENCES reputation.validators(id),
  type             TEXT        NOT NULL,
  domain           TEXT,
  delta            NUMERIC(10,6) NOT NULL,
  reason           TEXT,
  related_loop_id  UUID,
  timestamp        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rep_events_validator ON reputation.events(validator_id);
CREATE INDEX IF NOT EXISTS idx_rep_validators_active ON reputation.validators(is_active, aggregate_reputation DESC);
