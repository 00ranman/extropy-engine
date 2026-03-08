-- Migration 002: Interop & Event Integration Tables
-- Bridges HomeFlow IoT tables (001) with ecosystem event bus
-- Required before household management tables (003)

-- Event log for HomeFlow -> Extropy Engine event bus integration
CREATE TABLE IF NOT EXISTS hf_event_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID NOT NULL REFERENCES hf_households(id),
  event_type VARCHAR(100) NOT NULL,
  source_service VARCHAR(100) NOT NULL DEFAULT 'homeflow',
  target_service VARCHAR(100),
  payload JSONB NOT NULL DEFAULT '{}',
  correlation_id UUID,
  published_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  acknowledged_at TIMESTAMPTZ
);

CREATE INDEX idx_hf_event_log_household ON hf_event_log(household_id);
CREATE INDEX idx_hf_event_log_type ON hf_event_log(event_type);
CREATE INDEX idx_hf_event_log_published ON hf_event_log(published_at);

-- XP transactions for household actions (bridges to XP Mint service)
CREATE TABLE IF NOT EXISTS hf_xp_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID NOT NULL REFERENCES hf_households(id),
  member_id VARCHAR(255) NOT NULL,
  action_type VARCHAR(100) NOT NULL,
  action_id UUID,
  xp_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  formula_used VARCHAR(50) NOT NULL,
  formula_inputs JSONB NOT NULL DEFAULT '{}',
  minted BOOLEAN NOT NULL DEFAULT false,
  mint_event_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_hf_xp_household ON hf_xp_transactions(household_id);
CREATE INDEX idx_hf_xp_member ON hf_xp_transactions(member_id);
CREATE INDEX idx_hf_xp_action_type ON hf_xp_transactions(action_type);

-- Interop adapter configuration (which services this HomeFlow connects to)
CREATE TABLE IF NOT EXISTS hf_interop_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID NOT NULL REFERENCES hf_households(id),
  service_name VARCHAR(100) NOT NULL,
  service_url VARCHAR(500) NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  last_sync_at TIMESTAMPTZ,
  sync_status VARCHAR(50) DEFAULT 'pending',
  config JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(household_id, service_name)
);

-- Entropy claims generated from household actions
CREATE TABLE IF NOT EXISTS hf_entropy_claims (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID NOT NULL REFERENCES hf_households(id),
  claim_type VARCHAR(100) NOT NULL,
  source_action VARCHAR(100) NOT NULL,
  source_id UUID,
  delta_s NUMERIC(10,4) NOT NULL,
  evidence JSONB NOT NULL DEFAULT '{}',
  epistemology_claim_id UUID,
  loop_id UUID,
  status VARCHAR(50) NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_hf_entropy_claims_household ON hf_entropy_claims(household_id);
CREATE INDEX idx_hf_entropy_claims_status ON hf_entropy_claims(status);
