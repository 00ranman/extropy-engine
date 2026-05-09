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

-- Shared enum type for entropy domains (all 8 values)
CREATE TYPE entropy_domain AS ENUM (
  'cognitive', 'code', 'social', 'economic', 'thermodynamic', 'informational',
  'governance', 'temporal'
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

-- DAG edges table for efficient ancestor/descendant queries
CREATE TABLE ledger.dag_edges (
  parent_loop_id TEXT NOT NULL,
  child_loop_id  TEXT NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (parent_loop_id, child_loop_id)
);

CREATE INDEX idx_dag_parent ON ledger.dag_edges(parent_loop_id);
CREATE INDEX idx_dag_child ON ledger.dag_edges(child_loop_id);

-- ── Reputation Tables ─────────────────────────────────────────────────────

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

-- ── XP Mint Tables ────────────────────────────────────────────────────────

-- XP formula columns use canonical v3.1.2 labels:
--   rarity_multiplier   = R (action-class scarcity, NOT reputation)
--   frequency_of_decay  = F (diminishing returns for repeated actions)
-- See packages/xp-mint/migrations/002_canonical_formula_v3_1_2.sql for
-- the rationale and the legacy column rename.
CREATE TABLE mint.mint_events (
  id                          TEXT PRIMARY KEY,
  loop_id                     TEXT NOT NULL,
  status                      TEXT NOT NULL DEFAULT 'provisional',
  rarity_multiplier           DOUBLE PRECISION NOT NULL,
  frequency_of_decay          DOUBLE PRECISION NOT NULL,
  delta_s                     DOUBLE PRECISION NOT NULL,
  domain_essentiality_product DOUBLE PRECISION NOT NULL,
  settlement_time_factor      DOUBLE PRECISION NOT NULL,
  xp_value                    DOUBLE PRECISION NOT NULL,
  distribution                JSONB NOT NULL DEFAULT '[]',
  total_minted                DOUBLE PRECISION NOT NULL,
  burn_reason                 TEXT,
  retroactive_validation_at   TIMESTAMPTZ,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  formula_version             TEXT NOT NULL DEFAULT 'canonical-v3.1.2',
  UNIQUE(loop_id)
);

CREATE INDEX idx_mint_status ON mint.mint_events(status);
CREATE INDEX idx_mint_loop ON mint.mint_events(loop_id);
CREATE INDEX idx_mint_formula_version ON mint.mint_events(formula_version);

-- ── Event Log (shared audit trail) ────────────────────────────────────────

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

-- ═══════════════════════════════════════════════════════════════════════════════
--  DAG SUBSTRATE
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE SCHEMA IF NOT EXISTS dag;

CREATE TABLE dag.vertices (
  id                  TEXT PRIMARY KEY,
  vertex_type         TEXT NOT NULL,
  signature           TEXT NOT NULL,
  public_key          TEXT NOT NULL,
  algorithm           TEXT NOT NULL DEFAULT 'ed25519',
  lamport_timestamp   BIGINT NOT NULL,
  wall_timestamp      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  parent_vertex_ids   TEXT[] DEFAULT '{}',
  content_hash        TEXT NOT NULL,
  confirmation_weight DOUBLE PRECISION NOT NULL DEFAULT 0,
  is_tip              BOOLEAN NOT NULL DEFAULT TRUE,
  payload             JSONB NOT NULL DEFAULT '{}',
  dfao_id             TEXT,
  origin_node_id      TEXT NOT NULL,
  hop_count           INTEGER NOT NULL DEFAULT 0,
  received_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locally_validated   BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX idx_vertices_type   ON dag.vertices(vertex_type);
CREATE INDEX idx_vertices_lamport ON dag.vertices(lamport_timestamp);
CREATE INDEX idx_vertices_tips   ON dag.vertices(is_tip) WHERE is_tip = TRUE;
CREATE INDEX idx_vertices_dfao   ON dag.vertices(dfao_id);
CREATE INDEX idx_vertices_pubkey ON dag.vertices(public_key);

-- Edges between vertices (parent → child references)
CREATE TABLE dag.edges (
  parent_vertex_id TEXT NOT NULL REFERENCES dag.vertices(id),
  child_vertex_id  TEXT NOT NULL REFERENCES dag.vertices(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (parent_vertex_id, child_vertex_id)
);

CREATE INDEX idx_dag_edges_parent ON dag.edges(parent_vertex_id);
CREATE INDEX idx_dag_edges_child  ON dag.edges(child_vertex_id);

-- DAG configuration (governance-adjustable)
CREATE TABLE dag.config (
  key                  TEXT PRIMARY KEY,
  value                JSONB NOT NULL,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by_proposal_id TEXT
);

-- ═══════════════════════════════════════════════════════════════════════════════
--  DFAO REGISTRY
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE SCHEMA IF NOT EXISTS dfao;

CREATE TABLE dfao.organizations (
  id                TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  description       TEXT NOT NULL DEFAULT '',
  status            TEXT NOT NULL DEFAULT 'shadow',
  scale             TEXT NOT NULL DEFAULT 'micro',
  parent_dfao_id    TEXT REFERENCES dfao.organizations(id),
  child_dfao_ids    TEXT[] DEFAULT '{}',
  founder_ids       TEXT[] NOT NULL,
  member_count      INTEGER NOT NULL DEFAULT 0,
  primary_domain    entropy_domain NOT NULL,
  secondary_domains TEXT[] DEFAULT '{}',
  governance_config JSONB NOT NULL DEFAULT '{}',
  token_config      JSONB NOT NULL DEFAULT '{}',
  creation_vertex_id TEXT,
  metadata          JSONB NOT NULL DEFAULT '{}',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_dfao_status ON dfao.organizations(status);
CREATE INDEX idx_dfao_parent ON dfao.organizations(parent_dfao_id);
CREATE INDEX idx_dfao_scale  ON dfao.organizations(scale);

CREATE TABLE dfao.memberships (
  dfao_id               TEXT NOT NULL REFERENCES dfao.organizations(id),
  validator_id          TEXT NOT NULL,
  role                  TEXT NOT NULL DEFAULT 'member',
  status                TEXT NOT NULL DEFAULT 'active',
  governance_weight     DOUBLE PRECISION NOT NULL DEFAULT 0,
  domain_contributions  JSONB NOT NULL DEFAULT '{}',
  total_contributions   INTEGER NOT NULL DEFAULT 0,
  joined_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_active_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  membership_vertex_id  TEXT,
  PRIMARY KEY (dfao_id, validator_id)
);

CREATE INDEX idx_memberships_validator ON dfao.memberships(validator_id);
CREATE INDEX idx_memberships_status    ON dfao.memberships(status);

-- ═══════════════════════════════════════════════════════════════════════════════
--  GOVERNANCE
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE SCHEMA IF NOT EXISTS governance;

CREATE TABLE governance.proposals (
  id                       TEXT PRIMARY KEY,
  dfao_id                  TEXT NOT NULL,
  type                     TEXT NOT NULL,
  title                    TEXT NOT NULL,
  description              TEXT NOT NULL,
  changes                  JSONB NOT NULL DEFAULT '[]',
  proposer_id              TEXT NOT NULL,
  status                   TEXT NOT NULL DEFAULT 'draft',
  deliberation_started_at  TIMESTAMPTZ,
  voting_started_at        TIMESTAMPTZ,
  voting_deadline          TIMESTAMPTZ,
  tally                    JSONB NOT NULL DEFAULT '{}',
  required_quorum          DOUBLE PRECISION NOT NULL DEFAULT 0.5,
  proposal_threshold       DOUBLE PRECISION NOT NULL DEFAULT 0,
  vertex_id                TEXT,
  season_id                TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at              TIMESTAMPTZ
);

CREATE INDEX idx_proposals_dfao   ON governance.proposals(dfao_id);
CREATE INDEX idx_proposals_status ON governance.proposals(status);
CREATE INDEX idx_proposals_season ON governance.proposals(season_id);

CREATE TABLE governance.votes (
  id               SERIAL PRIMARY KEY,
  proposal_id      TEXT NOT NULL REFERENCES governance.proposals(id),
  voter_id         TEXT NOT NULL,
  dfao_id          TEXT NOT NULL,
  vote             TEXT NOT NULL CHECK (vote IN ('approve', 'reject', 'abstain')),
  weight           DOUBLE PRECISION NOT NULL,
  raw_reputation   DOUBLE PRECISION NOT NULL,
  justification    TEXT,
  vertex_id        TEXT,
  timestamp        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (proposal_id, voter_id)
);

CREATE INDEX idx_votes_proposal ON governance.votes(proposal_id);
CREATE INDEX idx_votes_voter    ON governance.votes(voter_id);

-- Governance-adjustable parameters (current values)
CREATE TABLE governance.parameters (
  key                       TEXT PRIMARY KEY,
  value                     JSONB NOT NULL,
  last_changed_by_proposal  TEXT,
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Insert default governance parameters
INSERT INTO governance.parameters (key, value) VALUES
  ('domain_weights',            '{"cognitive":1.0,"code":1.0,"social":1.0,"economic":1.0,"thermodynamic":1.0,"informational":1.0,"governance":1.0,"temporal":1.0}'),
  ('essentiality_factor',       '0.8'),
  ('causal_closure_speeds',     '{"cognitive":1e-6,"code":1e-4,"social":1e-3,"economic":1e-2,"thermodynamic":1e-4,"informational":1e-5,"governance":1e-3,"temporal":1e-6}'),
  ('reputation_accrual_rate',   '0.1'),
  ('reputation_decay_rate',     '0.02'),
  ('ct_lockup_period_hours',    '336'),
  ('ct_inactivity_burn_days',   '365'),
  ('xp_decay_rate',             '0.01'),
  ('season_duration_days',      '365'),
  ('min_reputation_threshold',  '0.1');

-- ═══════════════════════════════════════════════════════════════════════════════
--  TEMPORAL — Seasons & Epochs
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE SCHEMA IF NOT EXISTS temporal;

CREATE TABLE temporal.seasons (
  id                        TEXT PRIMARY KEY,
  number                    INTEGER NOT NULL UNIQUE,
  name                      TEXT NOT NULL,
  status                    TEXT NOT NULL DEFAULT 'upcoming',
  started_at                TIMESTAMPTZ,
  ends_at                   TIMESTAMPTZ,
  completed_at              TIMESTAMPTZ,
  reward_multiplier         DOUBLE PRECISION NOT NULL DEFAULT 1.0,
  starting_rankings_snapshot JSONB,
  final_rankings            JSONB,
  start_vertex_id           TEXT,
  end_vertex_id             TEXT,
  total_xp_minted           DOUBLE PRECISION NOT NULL DEFAULT 0,
  total_loops_closed        INTEGER NOT NULL DEFAULT 0,
  metadata                  JSONB NOT NULL DEFAULT '{}',
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_seasons_status ON temporal.seasons(status);
CREATE INDEX idx_seasons_number ON temporal.seasons(number);

-- Scheduled tasks (loop timeouts, decay ticks, etc.)
CREATE TABLE temporal.scheduled_tasks (
  id               TEXT PRIMARY KEY,
  task_type        TEXT NOT NULL,
  target_entity_id TEXT,
  scheduled_for    TIMESTAMPTZ NOT NULL,
  executed_at      TIMESTAMPTZ,
  status           TEXT NOT NULL DEFAULT 'pending',
  payload          JSONB NOT NULL DEFAULT '{}',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_scheduled_tasks_due  ON temporal.scheduled_tasks(scheduled_for) WHERE status = 'pending';
CREATE INDEX idx_scheduled_tasks_type ON temporal.scheduled_tasks(task_type);

-- ═══════════════════════════════════════════════════════════════════════════════
--  ECONOMY — Token Economy
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE SCHEMA IF NOT EXISTS economy;

CREATE TABLE economy.wallets (
  id               TEXT PRIMARY KEY,
  validator_id     TEXT NOT NULL UNIQUE,
  balances         JSONB NOT NULL DEFAULT '{"xp":0,"ct":0,"cat":0,"it":0,"dt":0,"ep":0}',
  locked_balances  JSONB NOT NULL DEFAULT '{"xp":0,"ct":0,"cat":0,"it":0,"dt":0,"ep":0}',
  non_transferable JSONB NOT NULL DEFAULT '{"xp":true,"ct":false,"cat":false,"it":true,"dt":false,"ep":false}',
  last_activity_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_wallets_validator ON economy.wallets(validator_id);

CREATE TABLE economy.token_balances (
  id               TEXT PRIMARY KEY,
  wallet_id        TEXT NOT NULL REFERENCES economy.wallets(id),
  validator_id     TEXT NOT NULL,
  token_type       TEXT NOT NULL,
  amount           DOUBLE PRECISION NOT NULL DEFAULT 0,
  status           TEXT NOT NULL DEFAULT 'active',
  lockup_expires_at TIMESTAMPTZ,
  last_activity_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  domain           entropy_domain,
  dfao_id          TEXT,
  season_id        TEXT,
  last_vertex_id   TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_token_balances_wallet    ON economy.token_balances(wallet_id);
CREATE INDEX idx_token_balances_validator ON economy.token_balances(validator_id);
CREATE INDEX idx_token_balances_type      ON economy.token_balances(token_type);
CREATE INDEX idx_token_balances_status    ON economy.token_balances(status);

CREATE TABLE economy.transactions (
  id                   TEXT PRIMARY KEY,
  token_type           TEXT NOT NULL,
  action               TEXT NOT NULL,
  amount               DOUBLE PRECISION NOT NULL,
  from_wallet_id       TEXT,
  to_wallet_id         TEXT,
  related_entity_id    TEXT,
  related_entity_type  TEXT,
  reason               TEXT NOT NULL,
  vertex_id            TEXT,
  season_id            TEXT,
  timestamp            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_transactions_type   ON economy.transactions(token_type);
CREATE INDEX idx_transactions_action ON economy.transactions(action);
CREATE INDEX idx_transactions_from   ON economy.transactions(from_wallet_id);
CREATE INDEX idx_transactions_to     ON economy.transactions(to_wallet_id);

CREATE TABLE economy.cat_certifications (
  id                      TEXT PRIMARY KEY,
  validator_id            TEXT NOT NULL,
  domain                  entropy_domain NOT NULL,
  level                   INTEGER NOT NULL DEFAULT 0,
  validated_performances  INTEGER NOT NULL DEFAULT 0,
  next_level_threshold    INTEGER NOT NULL DEFAULT 10,
  last_certified_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  recertification_due     BOOLEAN NOT NULL DEFAULT FALSE,
  mentorship_bonuses      DOUBLE PRECISION NOT NULL DEFAULT 0,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (validator_id, domain)
);

CREATE INDEX idx_cat_certs_validator ON economy.cat_certifications(validator_id);

-- ═══════════════════════════════════════════════════════════════════════════════
--  CREDENTIALS — Cosmetic Rewards
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE SCHEMA IF NOT EXISTS credentials;

CREATE TABLE credentials.credentials (
  id                       TEXT PRIMARY KEY,
  validator_id             TEXT NOT NULL,
  type                     TEXT NOT NULL,
  name                     TEXT NOT NULL,
  description              TEXT NOT NULL DEFAULT '',
  level                    INTEGER,
  domain                   entropy_domain,
  season_id                TEXT,
  persists_across_seasons  BOOLEAN NOT NULL DEFAULT FALSE,
  vertex_id                TEXT,
  visual_metadata          JSONB NOT NULL DEFAULT '{}',
  issued_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at               TIMESTAMPTZ,
  revoked_at               TIMESTAMPTZ
);

CREATE INDEX idx_credentials_validator ON credentials.credentials(validator_id);
CREATE INDEX idx_credentials_type      ON credentials.credentials(type);
CREATE INDEX idx_credentials_season    ON credentials.credentials(season_id);

-- ═══════════════════════════════════════════════════════════════════════════════
--  ECOSYSTEM — Integration APIs
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE SCHEMA IF NOT EXISTS ecosystem;

CREATE TABLE ecosystem.skill_nodes (
  id                   TEXT PRIMARY KEY,
  name                 TEXT NOT NULL,
  domain               entropy_domain NOT NULL,
  prerequisite_ids     TEXT[] DEFAULT '{}',
  required_cat_level   INTEGER NOT NULL DEFAULT 0,
  dfao_id              TEXT,
  mastery_threshold    INTEGER NOT NULL DEFAULT 10,
  metadata             JSONB NOT NULL DEFAULT '{}',
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_skill_nodes_domain ON ecosystem.skill_nodes(domain);

CREATE TABLE ecosystem.oracle_sources (
  id            TEXT PRIMARY KEY,
  platform      TEXT NOT NULL,
  mapping_rules JSONB NOT NULL DEFAULT '[]',
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  last_sync_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE ecosystem.xp_exchanges (
  id                   TEXT PRIMARY KEY,
  from_domain          entropy_domain NOT NULL,
  to_domain            entropy_domain NOT NULL,
  exchange_rate        DOUBLE PRECISION NOT NULL DEFAULT 0.9,
  transfer_friction    DOUBLE PRECISION NOT NULL DEFAULT 0.02,
  minimum_amount       DOUBLE PRECISION NOT NULL DEFAULT 1.0,
  governance_approved  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (from_domain, to_domain)
);
