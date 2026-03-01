-- ===============================================================================
--  EXTROPY ENGINE -- Database Initialization
-- ===============================================================================
--
--  Each service owns its own schema within the shared PostgreSQL instance.
--  This separation ensures data isolation while allowing cross-service
--  queries when absolutely necessary (preferring events for normal flow).
--
-- ===============================================================================

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

-- -- Epistemology Engine Tables ---------------------------------------------

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

-- -- SignalFlow Tables -----------------------------------------------------

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

-- -- Loop Ledger Tables ----------------------------------------------------

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

-- DAG edges table for efficient ancestor/descendant queries
CREATE TABLE ledger.dag_edges (
  parent_loop_id TEXT NOT NULL,
  child_loop_id  TEXT NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (parent_loop_id, child_loop_id)
);

CREATE INDEX idx_dag_parent ON ledger.dag_edges(parent_loop_id);
CREATE INDEX idx_dag_child ON ledger.dag_edges(child_loop_id);

-- -- Reputation Tables -----------------------------------------------------

CREATE TABLE reputation.validators (
  id                   TEXT PRIMARY KEY,
  name                 TEXT NOT NULL,
  type                 TEXT NOT NULL CHECK (type IN ('human', 'ai', 'hybrid')),
  domains              TEXT[] NOT NULL,
  aggregate_reputation DOUBLE PRECISION NOT NULL DEFAULT 1.0,
  reputation_by_domain JSONB NOT NULL DEFAULT '{}',
  accrual_rate         DOUBLE PRECISION NOT NULL DEFAULT 0.1,
  decay_rate           DOUBLE PRECISION NOT NULL DEFAULT 0.02,
  current_streak       INTEGER NOT NULL DEFAULT 0,
  penalty_count        INTEGER NOT NULL DEFAULT 0,
  total_xp_earned      DOUBLE PRECISION NOT NULL DEFAULT 0,
  loops_participated   INTEGER NOT NULL DEFAULT 0,
  accurate_validations INTEGER NOT NULL DEFAULT 0,
  current_task_count   INTEGER NOT NULL DEFAULT 0,
  max_concurrent_tasks INTEGER NOT NULL DEFAULT 5,
  is_active            BOOLEAN NOT NULL DEFAULT TRUE,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_active_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE reputation.events (
  id              SERIAL PRIMARY KEY,
  validator_id    TEXT NOT NULL REFERENCES reputation.validators(id),
  type            TEXT NOT NULL CHECK (type IN ('accrual', 'decay', 'penalty', 'bonus')),
  domain          entropy_domain NOT NULL,
  delta           DOUBLE PRECISION NOT NULL,
  reason          TEXT NOT NULL,
  related_loop_id TEXT,
  timestamp       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_rep_events_validator ON reputation.events(validator_id);

-- -- XP Mint Tables --------------------------------------------------------

CREATE TABLE mint.mint_events (
  id                          TEXT PRIMARY KEY,
  loop_id                     TEXT NOT NULL,
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
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(loop_id)
);

CREATE INDEX idx_mint_status ON mint.mint_events(status);
CREATE INDEX idx_mint_loop ON mint.mint_events(loop_id);

-- -- Event Log (shared audit trail) ----------------------------------------

CREATE TABLE public.event_log (
  id             BIGSERIAL PRIMARY KEY,
  event_id       TEXT NOT NULL UNIQUE,
  type           TEXT NOT NULL,
  payload        JSONB NOT NULL,
  source         TEXT NOT NULL,
  correlation_id TEXT NOT NULL,
  version        INTEGER NOT NULL DEFAULT 1,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_events_type ON public.event_log(type);
CREATE INDEX idx_events_correlation ON public.event_log(correlation_id);
CREATE INDEX idx_events_source ON public.event_log(source);
