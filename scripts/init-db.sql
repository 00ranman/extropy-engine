-- ═══════════════════════════════════════════════════════════════════════════════
--  EXTROPY ENGINE — Database Initialization
-- ═══════════════════════════════════════════════════════════════════════════════
--
--  Each service owns its own schema within the shared PostgreSQL instance.
--  This separation ensures data isolation while allowing cross-service
--  queries when absolutely necessary (preferring events for normal flow).
--
-- ═══════════════════════════════════════════════════════════════════════════════

-- Create schemas for each service
CREATE SCHEMA IF NOT EXISTS epistemology;
CREATE SCHEMA IF NOT EXISTS signalflow;
CREATE SCHEMA IF NOT EXISTS ledger;
CREATE SCHEMA IF NOT EXISTS reputation;
CREATE SCHEMA IF NOT EXISTS mint;

-- Shared enum type for entropy domains
CREATE TYPE entropy_domain AS ENUM (
  'cognitive', 'code', 'social', 'economic', 'thermodynamic', 'informational'
);

-- ── Epistemology Engine Tables ─────────────────────────────────────────────

CREATE TABLE epistemology.claims (
  id            TEXT PRIMARY KEY,
  loop_id       TEXT NOT NULL,
  statement     TEXT NOT NULL,
  domain        entropy_domain NOT NULL,
  submitter_id  TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'submitted',
  truth_score   DOUBLE PRECISION DEFAULT 0,
  bayesian_prior JSONB NOT NULL DEFAULT '{}',
  sub_claim_ids TEXT[] DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE epistemology.sub_claims (
  id                    TEXT PRIMARY KEY,
  claim_id              TEXT NOT NULL REFERENCES epistemology.claims(id),
  loop_id               TEXT NOT NULL,
  statement             TEXT NOT NULL,
  domain                entropy_domain NOT NULL,
  status                TEXT NOT NULL DEFAULT 'pending',
  bayesian_prior        JSONB NOT NULL DEFAULT '{}',
  measurement_ids       TEXT[] DEFAULT '{}',
  assigned_validator_ids TEXT[] DEFAULT '{}',
  weight                DOUBLE PRECISION NOT NULL DEFAULT 1.0,
  depends_on            TEXT[] DEFAULT '{}',
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at           TIMESTAMPTZ
);

-- ── SignalFlow Tables ─────────────────────────────────────────────────────

CREATE TABLE signalflow.tasks (
  id                    TEXT PRIMARY KEY,
  sub_claim_id          TEXT NOT NULL,
  loop_id               TEXT NOT NULL,
  assigned_validator_id TEXT,
  status                TEXT NOT NULL DEFAULT 'created',
  priority              INTEGER NOT NULL DEFAULT 50,
  routing_reason        JSONB,
  deadline              TIMESTAMPTZ,
  result                JSONB,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  assigned_at           TIMESTAMPTZ,
  completed_at          TIMESTAMPTZ
);

CREATE INDEX idx_tasks_validator ON signalflow.tasks(assigned_validator_id);
CREATE INDEX idx_tasks_status ON signalflow.tasks(status);
CREATE INDEX idx_tasks_loop ON signalflow.tasks(loop_id);

-- ── Loop Ledger Tables ────────────────────────────────────────────────────

CREATE TABLE ledger.loops (
  id                      TEXT PRIMARY KEY,
  claim_id                TEXT NOT NULL,
  status                  TEXT NOT NULL DEFAULT 'open',
  domain                  entropy_domain NOT NULL,
  entropy_before          JSONB,
  entropy_after           JSONB,
  delta_s                 DOUBLE PRECISION,
  validator_ids           TEXT[] DEFAULT '{}',
  task_ids                TEXT[] DEFAULT '{}',
  consensus               JSONB,
  parent_loop_ids         TEXT[] DEFAULT '{}',
  child_loop_ids          TEXT[] DEFAULT '{}',
  settlement_time_seconds DOUBLE PRECISION,
  causal_closure_speed    DOUBLE PRECISION NOT NULL,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at               TIMESTAMPTZ,
  settled_at              TIMESTAMPTZ
);

CREATE TABLE ledger.measurements (
  id            TEXT PRIMARY KEY,
  loop_id       TEXT NOT NULL REFERENCES ledger.loops(id),
  domain        entropy_domain NOT NULL,
  phase         TEXT NOT NULL CHECK (phase IN ('before', 'after')),
  value         DOUBLE PRECISION NOT NULL,
  uncertainty   DOUBLE PRECISION NOT NULL DEFAULT 0,
  source        JSONB NOT NULL,
  raw_payload   JSONB,
  timestamp     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(loop_id, phase)
);

CREATE INDEX idx_loops_status ON ledger.loops(status);
CREATE INDEX idx_loops_domain ON ledger.loops(domain);

-- DAG edges table for parent-child loop relationships
CREATE TABLE ledger.loop_dag_edges (
  parent_loop_id TEXT NOT NULL REFERENCES ledger.loops(id),
  child_loop_id  TEXT NOT NULL REFERENCES ledger.loops(id),
  PRIMARY KEY (parent_loop_id, child_loop_id)
);

-- ── Reputation Tables ────────────────────────────────────────────────────

CREATE TABLE reputation.validators (
  id                    TEXT PRIMARY KEY,
  aggregate             DOUBLE PRECISION NOT NULL DEFAULT 1.0,
  domain_reputations    JSONB NOT NULL DEFAULT '{}',
  xp_balance            DOUBLE PRECISION NOT NULL DEFAULT 0,
  validation_count      INTEGER NOT NULL DEFAULT 0,
  last_active           TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE reputation.reputation_events (
  id            TEXT PRIMARY KEY,
  validator_id  TEXT NOT NULL REFERENCES reputation.validators(id),
  event_type    TEXT NOT NULL,
  domain        entropy_domain,
  delta         DOUBLE PRECISION NOT NULL,
  xp_earned     DOUBLE PRECISION NOT NULL DEFAULT 0,
  loop_id       TEXT,
  reason        TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_rep_events_validator ON reputation.reputation_events(validator_id);
CREATE INDEX idx_rep_events_loop ON reputation.reputation_events(loop_id);

-- ── Mint Tables ──────────────────────────────────────────────────────────

CREATE TABLE mint.mint_events (
  id                          TEXT PRIMARY KEY,
  loop_id                     TEXT NOT NULL UNIQUE,
  status                      TEXT NOT NULL DEFAULT 'provisional',
  reputation_factor           DOUBLE PRECISION NOT NULL,
  feedback_closure_strength   DOUBLE PRECISION NOT NULL,
  delta_s                     DOUBLE PRECISION NOT NULL,
  domain_essentiality_product DOUBLE PRECISION NOT NULL,
  settlement_time_factor      DOUBLE PRECISION NOT NULL,
  xp_value                    DOUBLE PRECISION NOT NULL,
  distribution                JSONB NOT NULL DEFAULT '[]',
  total_minted                DOUBLE PRECISION NOT NULL,
  burn_reason                 TEXT,
  retroactive_validation_at   TIMESTAMPTZ,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_mint_events_loop ON mint.mint_events(loop_id);
CREATE INDEX idx_mint_events_status ON mint.mint_events(status);

-- ── Event Sourcing Tables (shared) ───────────────────────────────────────────

CREATE TABLE public.domain_events (
  id            TEXT PRIMARY KEY,
  type          TEXT NOT NULL,
  loop_id       TEXT NOT NULL,
  payload       JSONB NOT NULL,
  source        TEXT NOT NULL,
  version       INTEGER NOT NULL DEFAULT 1,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_domain_events_loop ON public.domain_events(loop_id);
CREATE INDEX idx_domain_events_type ON public.domain_events(type);
CREATE INDEX idx_domain_events_source ON public.domain_events(source);
