# Changelog

## v3.1.2 — 2026-05-08 (Canonical Formula Labels)

### The bug

Through v3.1.1 the XP mint pipeline (`packages/xp-mint/src/index.ts`) was
fetching validator reputation and feeding it into the **R** slot of the
canonical formula:

```
XP = R × F × ΔS × (w · E) × log(1/Tₛ)
```

That reading is incoherent. XP measures entropy reduction from a single
closed loop. Every multiplier must describe the loop, not the actor's
history. Multiplying reputation into XP creates reputation laundering:
past actions inflate new mints, and reputation compounds indefinitely.
A validator with rep=10 would mint 10× the XP of a validator with rep=1
for the **same entropy reduction**. That's an aristocracy bug, not a
physics-grounded protocol.

### The fix

- **R = Rarity** (action-class scarcity / base difficulty multiplier).
  Property of the loop's domain, NOT the actor.
- **F = Frequency-of-decay** penalty (diminishing returns for repeated
  instances of the same action class). Same semantics across XP and CT.
- Reputation legitimately governs:
  - **Vote weight (V+/V-)** in loop-ledger consensus (decides *whether*
    the loop closes, not how much it mints when it does).
  - **ρ (rho)** in the CT formula — CT is explicitly identity-bearing,
    so reputation belongs there.
- Reputation does NOT enter XP minting.

### Code changes

- `packages/xp-formula/src/index.ts` — docstring updated; the formula
  itself was already correct (R = Rarity, F = Frequency).
- `packages/contracts/src/types.ts`:
  - `XPFormulaInputs.reputation` → `rarity`
  - `XPFormulaInputs.feedbackClosure` → `frequencyOfDecay`
  - `XPMintEvent.reputationFactor` → `rarityMultiplier`
  - `XPMintEvent.feedbackClosureStrength` → `frequencyOfDecay`
  - `CTFormulaInputs.context` → `capability`
  - `CTFormulaInputs.feedbackClosure` → `frequencyOfDecay`
  - `CTFormulaInputs.reputation` → `reputationDensity`
- `packages/xp-mint/src/index.ts`:
  - Removed reputation lookup from XP calculation path entirely.
  - Added per-domain `RARITY_DEFAULTS` table (governance-tunable).
  - Added `FORMULA_VERSION = 'canonical-v3.1.2'` stamp on every new mint.
  - Reputation accrual (downstream effect of earning XP) is preserved —
    validators still build rep by closing loops; the rep just doesn't
    loop back into the mint amount.
- `packages/token-economy/src/index.ts`: `/ct/mint` accepts both
  canonical (`capability`, `frequencyOfDecay`, `reputationDensity`)
  and legacy (`context`, `feedbackClosure`, `reputation`) field names
  during the rollout window.
- `scripts/test-happy-path.sh`: reads canonical fields with legacy
  fallback.
- `scripts/init-db.sql`: fresh installs come up with canonical column
  names + `formula_version` column.

### Database migration

`packages/xp-mint/migrations/002_canonical_formula_v3_1_2.sql`:

- Renames `mint.mint_events.reputation_factor` → `rarity_multiplier`
- Renames `mint.mint_events.feedback_closure_strength` → `frequency_of_decay`
- Adds `formula_version` column (NOT NULL after backfill)
- Quarantines all pre-existing rows under `formula_version='pre-canonical-v3.1.0'`
- Provides `mint.mint_events_legacy` view for any external consumer still
  reading the old column names (drop in a future migration)
- Idempotent: safe to run repeatedly

Legacy rows are NOT recomputed. The DAG is event-sourced — history is
permanent, reinterpretation happens by appending future vertices.

### Math sanity check

Multiplication is commutative; the arithmetic is identical when the
formula's structure is preserved and only the source of R changes.
What changes is whose value gets multiplied in:

- Old (buggy): `R = aggregateValidatorReputation` → high-rep validators
  mint exponentially more for the same ΔS.
- New (canonical): `R = rarityForDomain(loop.domain)` → same-domain loops
  mint the same XP regardless of validator history.

Verified with `node /tmp/math_sanity.mjs` (rep=10 vs rep=1 produced 10×
ratio under the bug; canonical R produces invariance, as required).

## v3.1 — 2026-05-01 (Canonical)

### Vision
- Established **Digital Autarky** as the canonical framing: edge intelligence + protocol minimalism.

### Architecture
- **Redefined** `epistemology-engine`. The package and name are preserved. v3.0 read it as a central decomposition service; that reading was wrong. v3.1 recognizes it for what it always was: the mesh's emergent peer-review system, surfaced as a witness and aggregation layer over reputation-weighted validation activity. Decomposition itself moves to personal AI at the edge. See `SPEC_v3.1.md` §13.4 and `packages/epistemology-engine/README.md`.
- **Added** four new services: `identity/`, `psll-sync/`, `quest-market/`, `validation-neighborhoods/`.
- **Added** sandbox **`node-handshake/`** package: the proof-of-concept node-to-node communication layer for VPS↔local laptop testing. See `docs/VPS_NODE.md`.
- **Decision finalized:** native substrate, built end-to-end. Not a hApp on Holochain or any other framework.
- **Borrowed patterns** (re-implemented natively, credit given):
  - Holochain source chain → **Personal Signed Local Log (PSLL)**
  - Holochain neighborhood DHT → **Validation Neighborhoods**
  - Holochain zomes/DNA → **Rule Modules**

### Identity
- **Mandatory** hybrid identity layer: OAuth + on-device KYC + ZKP DID.
- Per-context nullifiers for Sybil resistance.
- Threshold-keyed governance reveal (provisional 7-of-12 ecosystem validators).

### Operational model
- **Micro-quest marketplace** is now first-class: 2–5 minute do-it-now tasks.
- **Dynamic reward escalation** (provisional curve: linear 1.0×→3.0× over 7d, log to cap 10.0×).
- **Volunteer micro-validation** via 1/10th blind slices is the default validation primitive.

### Documentation
- 63 open engineering gaps enumerated across 13 categories in `GAPS.md`.
- New companion specs: `IDENTITY.md`, `PSLL.md`, `QUEST_MARKET.md`, `GOVERNANCE_DEFAULTS.md`.
- All provisional defaults marked governance-tunable.

### Sandbox / Testing
- **Added** `docs/VPS_NODE.md` describing the sandbox-node deployment posture honestly: this is a live engineering testbed, not a hardened production deployment.
- **Added** `tools/node-handshake/test-handshake.sh` end-to-end harness for exercising the VPS↔local laptop handshake.

### Housekeeping
- `docs/SPEC_v3.0_DEPRECATED.md` added as a tombstone explaining why v3.0 was superseded and how v3.1 corrects the reading of the epistemology engine.
- Updated root README to reflect personal-AI handshake model, redefined epistemology engine, and Digital Autarky.

## v3.0 — prior

Superseded. See `SPEC_v3.0_DEPRECATED.md` (when archived).
