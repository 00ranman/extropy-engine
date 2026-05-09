-- Migration 002: Canonical XP formula labels (v3.1.2)
--
-- Background
-- ----------
-- Through v3.1.1, the XP mint pipeline mistakenly fed validator
-- *reputation* into the R slot of the formula:
--
--     XP = R × F × ΔS × (w·E) × log(1/Tₛ)
--
-- This is reputation laundering: past actions inflate new mints, and
-- reputation compounds indefinitely. The canonical reading of the
-- protocol is:
--
--   R = Rarity (action-class scarcity / base difficulty)
--   F = Frequency-of-decay penalty
--
-- Reputation legitimately governs vote weight (V+/V-) and the CT
-- formula (ρ), but does NOT enter XP minting.
--
-- This migration:
--   1. Renames the storage columns to match the canonical labels.
--   2. Adds formula_version so legacy and canonical mints are
--      distinguishable forever.
--   3. Quarantines all pre-existing rows under 'pre-canonical-v3.1.0'.
--      They are NOT recomputed; we keep them as-is for audit and
--      replay purposes. The DAG architecture is event-sourced, so
--      re-interpretation happens by appending future vertices, not
--      by mutating history.
--
-- Idempotent: safe to run repeatedly.

BEGIN;

-- 1. Rename columns to canonical names. Use IF EXISTS guards for idempotency.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'mint' AND table_name = 'mint_events'
      AND column_name = 'reputation_factor'
  ) THEN
    ALTER TABLE mint.mint_events RENAME COLUMN reputation_factor TO rarity_multiplier;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'mint' AND table_name = 'mint_events'
      AND column_name = 'feedback_closure_strength'
  ) THEN
    ALTER TABLE mint.mint_events RENAME COLUMN feedback_closure_strength TO frequency_of_decay;
  END IF;
END $$;

-- 2. Add formula_version column (nullable so the backfill below can
--    distinguish legacy from canonical mints).
ALTER TABLE mint.mint_events
  ADD COLUMN IF NOT EXISTS formula_version TEXT;

-- 3. Quarantine: any row without a formula_version was minted under
--    the buggy "R = reputation" interpretation. Tag them.
UPDATE mint.mint_events
   SET formula_version = 'pre-canonical-v3.1.0'
 WHERE formula_version IS NULL;

-- 4. From here forward, formula_version is required.
ALTER TABLE mint.mint_events
  ALTER COLUMN formula_version SET NOT NULL;

-- 5. Index on formula_version for audit queries (e.g. "show all
--    quarantined mints").
CREATE INDEX IF NOT EXISTS idx_mint_formula_version
  ON mint.mint_events(formula_version);

-- 6. Backward-compatible aliases. Any external client still reading
--    reputation_factor / feedback_closure_strength gets the canonical
--    values until they cut over. Drop these in a future migration
--    once all consumers are updated.
CREATE OR REPLACE VIEW mint.mint_events_legacy AS
  SELECT
    id,
    loop_id,
    status,
    rarity_multiplier         AS reputation_factor,
    frequency_of_decay        AS feedback_closure_strength,
    rarity_multiplier,
    frequency_of_decay,
    delta_s,
    domain_essentiality_product,
    settlement_time_factor,
    xp_value,
    distribution,
    total_minted,
    burn_reason,
    retroactive_validation_at,
    created_at,
    formula_version
  FROM mint.mint_events;

COMMIT;
