-- ═══════════════════════════════════════════════════════════════════════════
--  GrantFlow Discovery — Database Migration 001
--  Initial schema creation
-- ═══════════════════════════════════════════════════════════════════════════
--
--  Tables:
--    gf_profiles       — Researcher profiles with keywords, domains, expertise
--    gf_opportunities  — Cached grant opportunities from Grants.gov
--    gf_matches        — Scored matches between opportunities and profiles
--    gf_submissions    — Application submission pipeline entries
--    gf_search_runs    — Log of all discovery cycle executions
--    gf_claim_records  — Extropy Engine claim/loop tracking records
--
--  Run with:
--    psql $DATABASE_URL -f migrations/001_init_grantflow_discovery.sql
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── Extensions ──────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";  -- For future full-text search on descriptions

-- ── Researcher Profiles ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS gf_profiles (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name              TEXT        NOT NULL,
  email             TEXT,
  keywords          TEXT[]      NOT NULL DEFAULT '{}',
  domains           TEXT[]      NOT NULL DEFAULT '{}',
  past_awards       TEXT[]      NOT NULL DEFAULT '{}',
  expertise         TEXT[]      NOT NULL DEFAULT '{}',
  min_award_amount  NUMERIC(15,2),
  max_award_amount  NUMERIC(15,2),
  eligibility_types TEXT[]      NOT NULL DEFAULT '{}',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  gf_profiles IS 'Researcher profiles used for grant opportunity matching';
COMMENT ON COLUMN gf_profiles.keywords IS 'Keywords for Grants.gov API search queries';
COMMENT ON COLUMN gf_profiles.domains IS 'Research domains (maps to Extropy Engine EntropyDomain)';
COMMENT ON COLUMN gf_profiles.past_awards IS 'Previous grant award numbers or titles';
COMMENT ON COLUMN gf_profiles.expertise IS 'Free-text expertise descriptions for NLP matching';
COMMENT ON COLUMN gf_profiles.eligibility_types IS 'Grants.gov eligibility codes (e.g. "25" for individuals)';

CREATE INDEX IF NOT EXISTS idx_gf_profiles_email ON gf_profiles(email);
CREATE INDEX IF NOT EXISTS idx_gf_profiles_created_at ON gf_profiles(created_at DESC);

-- ── Grant Opportunities ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS gf_opportunities (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  opp_number         TEXT        NOT NULL UNIQUE,
  title              TEXT        NOT NULL,
  agency             TEXT        NOT NULL,
  agency_code        TEXT,
  description        TEXT        NOT NULL DEFAULT '',
  award_ceiling      NUMERIC(15,2),
  award_floor        NUMERIC(15,2),
  expected_awards    INTEGER,
  open_date          DATE,
  close_date         DATE,
  category           TEXT,
  funding_instrument TEXT,
  eligibility        TEXT[]      NOT NULL DEFAULT '{}',
  cfda_numbers       TEXT[]      NOT NULL DEFAULT '{}',
  status             TEXT        NOT NULL DEFAULT 'posted'
                     CHECK (status IN ('forecasted', 'posted', 'closed', 'archived')),
  raw_data           JSONB       NOT NULL DEFAULT '{}',
  discovered_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  gf_opportunities IS 'Cached grant opportunities discovered from Grants.gov';
COMMENT ON COLUMN gf_opportunities.opp_number IS 'Grants.gov opportunity number — used as unique key for upserts';
COMMENT ON COLUMN gf_opportunities.raw_data IS 'Full raw API response for audit trail and future processing';
COMMENT ON COLUMN gf_opportunities.status IS 'forecasted|posted|closed|archived (from Grants.gov)';

CREATE INDEX IF NOT EXISTS idx_gf_opportunities_status ON gf_opportunities(status);
CREATE INDEX IF NOT EXISTS idx_gf_opportunities_close_date ON gf_opportunities(close_date ASC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_gf_opportunities_award_ceiling ON gf_opportunities(award_ceiling);
CREATE INDEX IF NOT EXISTS idx_gf_opportunities_discovered_at ON gf_opportunities(discovered_at DESC);
CREATE INDEX IF NOT EXISTS idx_gf_opportunities_agency ON gf_opportunities(agency);

-- Full-text search index on title + description for future semantic matching
CREATE INDEX IF NOT EXISTS idx_gf_opportunities_fts ON gf_opportunities
  USING GIN (to_tsvector('english', coalesce(title, '') || ' ' || coalesce(description, '')));

-- ── Grant-Profile Matches ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS gf_matches (
  id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id   UUID         NOT NULL REFERENCES gf_opportunities(id) ON DELETE CASCADE,
  profile_id       UUID         NOT NULL REFERENCES gf_profiles(id)      ON DELETE CASCADE,
  score            NUMERIC(5,2) NOT NULL DEFAULT 0
                   CHECK (score >= 0 AND score <= 100),
  match_reasons    TEXT[]       NOT NULL DEFAULT '{}',
  keyword_matches  TEXT[]       NOT NULL DEFAULT '{}',
  domain_matches   TEXT[]       NOT NULL DEFAULT '{}',
  award_amount_fit BOOLEAN      NOT NULL DEFAULT FALSE,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_gf_match_opp_profile UNIQUE (opportunity_id, profile_id)
);

COMMENT ON TABLE  gf_matches IS 'Scored matches between grant opportunities and researcher profiles';
COMMENT ON COLUMN gf_matches.score IS 'Match score 0-100 based on keyword/domain overlap and award fit';
COMMENT ON COLUMN gf_matches.match_reasons IS 'Human-readable reasons for the score';

CREATE INDEX IF NOT EXISTS idx_gf_matches_profile_id ON gf_matches(profile_id);
CREATE INDEX IF NOT EXISTS idx_gf_matches_opportunity_id ON gf_matches(opportunity_id);
CREATE INDEX IF NOT EXISTS idx_gf_matches_score ON gf_matches(score DESC);
CREATE INDEX IF NOT EXISTS idx_gf_matches_created_at ON gf_matches(created_at DESC);

-- ── Submission Pipeline ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS gf_submissions (
  id                         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id             UUID        NOT NULL REFERENCES gf_opportunities(id) ON DELETE CASCADE,
  profile_id                 UUID        NOT NULL REFERENCES gf_profiles(id)      ON DELETE CASCADE,
  proposal_id                TEXT,
  status                     TEXT        NOT NULL DEFAULT 'discovered'
                             CHECK (status IN (
                               'discovered', 'researching', 'drafting',
                               'review', 'submitted', 'awarded', 'declined', 'withdrawn'
                             )),
  status_history             JSONB       NOT NULL DEFAULT '[]',
  s2s_package_xml            TEXT,
  submitted_at               TIMESTAMPTZ,
  grants_gov_tracking_number TEXT,
  notes                      TEXT,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  gf_submissions IS 'Application submission pipeline entries tracking full lifecycle';
COMMENT ON COLUMN gf_submissions.status IS 'Current pipeline stage: discovered→researching→drafting→review→submitted→awarded/declined';
COMMENT ON COLUMN gf_submissions.status_history IS 'JSONB array of all status transitions with timestamps and notes';
COMMENT ON COLUMN gf_submissions.s2s_package_xml IS 'Prepared SF-424 XML package for Grants.gov S2S submission';
COMMENT ON COLUMN gf_submissions.grants_gov_tracking_number IS 'Tracking number returned by Grants.gov on successful S2S submission';

CREATE INDEX IF NOT EXISTS idx_gf_submissions_profile_id ON gf_submissions(profile_id);
CREATE INDEX IF NOT EXISTS idx_gf_submissions_opportunity_id ON gf_submissions(opportunity_id);
CREATE INDEX IF NOT EXISTS idx_gf_submissions_status ON gf_submissions(status);
CREATE INDEX IF NOT EXISTS idx_gf_submissions_created_at ON gf_submissions(created_at DESC);

-- ── Search Run Log ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS gf_search_runs (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  query          TEXT        NOT NULL,
  results_count  INTEGER     NOT NULL DEFAULT 0,
  matches_found  INTEGER     NOT NULL DEFAULT 0,
  claims_emitted INTEGER     NOT NULL DEFAULT 0,
  success        BOOLEAN     NOT NULL DEFAULT TRUE,
  error_message  TEXT,
  duration_ms    INTEGER     NOT NULL DEFAULT 0,
  executed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  gf_search_runs IS 'Log of all discovery cycle executions (scheduled + manual)';
COMMENT ON COLUMN gf_search_runs.query IS 'Keywords used for the Grants.gov search';
COMMENT ON COLUMN gf_search_runs.duration_ms IS 'Total wall-clock time for the full cycle in milliseconds';

CREATE INDEX IF NOT EXISTS idx_gf_search_runs_executed_at ON gf_search_runs(executed_at DESC);
CREATE INDEX IF NOT EXISTS idx_gf_search_runs_success ON gf_search_runs(success);

-- ── Claim Records ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS gf_claim_records (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id       TEXT        NOT NULL,
  loop_id        TEXT        NOT NULL,
  claim_type     TEXT        NOT NULL
                 CHECK (claim_type IN (
                   'grant.discovered', 'grant.matched',
                   'submission.prepared', 'submission.submitted'
                 )),
  status         TEXT        NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending', 'submitted', 'verified', 'rejected', 'xp_minted')),
  opportunity_id UUID        REFERENCES gf_opportunities(id) ON DELETE SET NULL,
  profile_id     UUID        REFERENCES gf_profiles(id)      ON DELETE SET NULL,
  submission_id  UUID        REFERENCES gf_submissions(id)   ON DELETE SET NULL,
  xp_minted      NUMERIC(10,4),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  gf_claim_records IS 'Extropy Engine claim/loop tracking for XP minting via entropy verification';
COMMENT ON COLUMN gf_claim_records.loop_id IS 'Verification loop ID — used to match LOOP_CLOSED events';
COMMENT ON COLUMN gf_claim_records.claim_id IS 'Claim ID assigned by the Epistemology Engine';
COMMENT ON COLUMN gf_claim_records.xp_minted IS 'XP minted when the loop closed with verified ΔS > 0';

CREATE INDEX IF NOT EXISTS idx_gf_claim_records_loop_id ON gf_claim_records(loop_id);
CREATE INDEX IF NOT EXISTS idx_gf_claim_records_claim_id ON gf_claim_records(claim_id);
CREATE INDEX IF NOT EXISTS idx_gf_claim_records_status ON gf_claim_records(status);
CREATE INDEX IF NOT EXISTS idx_gf_claim_records_opportunity_id ON gf_claim_records(opportunity_id);

-- ── Seed: Randall Gossett's Researcher Profile ────────────────────────────────
-- This seed is inserted idempotently using ON CONFLICT DO NOTHING.

INSERT INTO gf_profiles (
  id,
  name,
  email,
  keywords,
  domains,
  past_awards,
  expertise,
  min_award_amount,
  max_award_amount,
  eligibility_types,
  created_at,
  updated_at
)
SELECT
  gen_random_uuid(),
  'Randall Gossett',
  '00ranman@gmail.com',
  ARRAY[
    'entropy', 'information theory', 'IoT', 'internet of things',
    'decentralized systems', 'smart home automation',
    'thermodynamic computation', 'distributed ledger', 'edge computing',
    'machine learning', 'digital twins', 'autonomous systems',
    'blockchain', 'sensor networks', 'energy efficiency'
  ],
  ARRAY[
    'entropy/information theory', 'IoT',
    'decentralized systems', 'smart home automation',
    'thermodynamic computation'
  ],
  ARRAY[]::TEXT[],
  ARRAY[
    'Information entropy measurement and reduction in distributed systems',
    'IoT device management and smart home automation',
    'Decentralized autonomous organizations and governance',
    'Thermodynamic computation models for digital systems',
    'Edge computing and sensor network architectures',
    'Blockchain-based verification and trust systems',
    'AI-powered autonomous agents'
  ],
  10000.00,
  1000000.00,
  ARRAY['individuals', 'small_businesses', 'unrestricted', '25', '12', '99'],
  NOW(),
  NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM gf_profiles WHERE email = '00ranman@gmail.com'
);

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════════
--  End of migration 001
-- ═══════════════════════════════════════════════════════════════════════════
