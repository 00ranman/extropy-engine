# Changelog

## Unreleased (Pending): Emergent Cross-Domain Exchange Rates

**Type:** specification architecture only. No formula-code change. No claim of empirical validation.

This entry is intentionally not assigned a version number. It changes documentation and protocol specification only. `@extropy/xp-formula` is untouched and remains `canonical-v3.1.3`. A version will be assigned when the accumulated specification corrections are released together.

### What changed

- **New `docs/EMERGENT_EXCHANGE_RATES.md`** (normative design document). Defines a two-tier normalization: a grounded tier of directly measured physical or informational quantities with operationally defined mappings, and a convention tier (cognitive, code, social, economic, governance, temporal, plus any informational claim lacking a direct operational mapping). Each convention-tier comparison to the grounded tier passes through an explicit emergent exchange coefficient X_d. X_d is a protocol accounting conversion, not a physical constant and not a proof of ontological identity. It is a velocity-bounded managed float, repriced through a high-rarity, broad-neighborhood, quorum-gated, reversible loop, using evidence independent of any XP computed from the same X_d. Missing provenance fails closed. Drift outrunning corroboration halts minting and reverts X_d to its last corroborated value.
- **`docs/NORMALIZATION.md`** gains section 5a summarizing the two-tier invariant and the X_d conversion stage, without overstating implementation. It states plainly that a Shannon bit is not automatically thermodynamic energy and that Landauer supplies only a lower bound for irreversible erasure under specified conditions.
- **`docs/PROTOCOL.md`** now names X_d provenance as a mint precondition (section 7) and rate repricing as a governed loop with halt and revert behavior (section 11).
- **`docs/GAPS.md`** gains Addendum A with 8 stable-ID gaps (X1 to X8). Total moves from 65 across 13 categories to 73 across 14 categories, computed as 65 + 8. The addendum distinguishes the resolved architectural defect (hidden and static cross-domain equivalence), the reduced risk on gaps 19 and 24 (commensurability now explicit, reversible, fail-closed), and what remains open (per-domain M_d, X_d initialization, independent estimator and identifiability, evidence-density rules, v_d and epoch calibration, adversarial repricing, persistent rate registry, external validation).
- **New `docs/GAP_FEEDBACK_CANDIDATES.md`** (non-normative). Candidate analysis of other gaps where the same corrective-feedback-loop mechanism might apply. Explicitly labeled candidate analysis, not adopted protocol.

### What did not change

- No numeric defaults were invented for X_d, v_d, epoch length, uncertainty thresholds, evidence density, or quorum.
- Reputation stays outside mint math. XP stays non-transferable and non-extractive. Prediction markets and fiat cash-out remain rejected.
- Canonical domains remain exactly cognitive, code, social, economic, thermodynamic, informational, governance, temporal.
- **Codex unchanged.** `docs/CODEX_v2.0.md`, `docs/CODEX_v2.0_COMPREHENSIVE.md`, and the generated Codex PDFs are not touched. These corrections are being accumulated for a later major Codex revision and are deliberately not folded into the Codex now.

## v3.1.3 — 2026-07 (T_s Floor, Non-Extraction, Protocol v0.1)

### The bug

Through v3.1.2 the XP mint pipeline in `packages/xp-mint/src/index.ts`
was calling `Math.log(1 / settlementTimeSeconds)` on **raw wall-clock
seconds**. That produced two failure modes at once:

1. **Speed-farming.** For any settlement below 1 second the log term
   diverged toward infinity as raw seconds → 0. A loop that closed in
   1 millisecond minted ≈ 6.9 × the XP of a loop that closed in 1
   second, all else equal. No cap.
2. **Silent zeroing.** For any settlement above 1 second the log term
   went negative, and the mint guard clamped negatives to zero. Every
   realistic loop (multi-second, minute, hour, day) minted **zero XP**.
   The `Math.max(fullXP, irreducibleXP)` fallback in the same function
   was masking this by falling back to the ΔS / c_L² branch, which is
   itself a rejected framing (see below).

Both failure modes were live in the code paths that would trigger on
real contribution loops.

### The fix

- **Canonical formula moved to `@extropy/xp-formula`** and stamped with
  `canonical-v3.1.3`. All service code MUST now import from there.
- **T_s is normalized-and-clamped at the formula boundary:**
  `Tₛ = exp(-λ · elapsedSeconds)`, clamped into `(T_floor, 1]`.
- **log-decay is capped:** `min(log(1/Tₛ), log(1/T_floor))`. Default
  `T_floor = 0.01` → hard cap ≈ 4.605. That is the actual anti-speed-
  farming invariant.
- **Property tests** in `packages/xp-formula/src/index.test.ts` cover
  bounded XP, log-decay bounds, sub-second attack neutralization, non-
  zero mint for realistic settlements, and the compile-time invariant
  that reputation cannot enter the formula.
- **`packages/xp-mint`** now routes every mint through
  `computeXPFromElapsedSeconds` and stamps the row with the formula
  version imported from `@extropy/xp-formula`, so version drift between
  the mint row and the executed math is now impossible.
- **`XP = ΔS / c_L²` is retired.** See `docs/REJECTED_FRAMINGS.md` R1.
  The `IrreducibleXPInputs` type is kept in `contracts` with a
  `@deprecated` marker for one release, then removed.

### Docs shipped in this release

- **`docs/NORMALIZATION.md`** — cross-domain ΔS normalization spec.
  Defines the bits-equivalent common unit bₑ, per-domain measurement
  operators M_d, and the four falsification conditions (F1–F4) that
  would sink the whole project if they hold in the wild.
- **`docs/NON_EXTRACTION.md`** — the no-cash-out invariant as an
  architectural constraint, parallel to Digital Autarky. XP and CT are
  stateful access thresholds, not balances. Prediction markets over
  loop outcomes are explicitly out of scope. Three tests every feature
  must pass: extraction, counterparty, ratio.
- **`docs/PROTOCOL.md` v0.1** — implementation-agnostic protocol
  contract. Any implementation in any language can conform to this
  document without depending on the reference TypeScript impl.
- **`docs/REJECTED_FRAMINGS.md`** — explicit registry of framings the
  project used to publish and no longer stands behind, with the
  reasoning and the replacement. R1 covers XP = ΔS / c_L².

### New package scaffold

- **`packages/github-parasite/`** (v0.1 scaffold, no runtime yet). GitHub
  App overlay: PR merges become code-contribution loops in the
  informational domain. XP is a function of the actor's contribution
  ratio ρ, not of any market position. Explicitly satisfies the three
  Non-Extraction tests; nothing this package emits is redeemable,
  transferable, or convertible into external value.

### Migration notes

- No database migration required. `settlementTimeSeconds` remains the
  storage-layer column name; its documented semantics change to "raw
  elapsed seconds at the storage boundary, normalize at the formula
  boundary."
- Pre-v3.1.3 mints are already quarantined under the
  `pre-canonical-v3.1.0` formula-version tag (migration 002). No
  further quarantine is required; the v3.1.3 stamp is applied to new
  mints only.

### Files touched

- `packages/xp-formula/src/index.ts` (rewrite; adds `T_FLOOR_DEFAULT`,
  `normalizeSettlementTime`, `computeXPFromElapsedSeconds`).
- `packages/xp-formula/src/index.test.ts` (new, 17 property tests).
- `packages/xp-mint/src/index.ts` (routes through @extropy/xp-formula;
  removes `calculateIrreducibleXP`; removes raw-seconds log call).
- `packages/xp-mint/package.json` (adds `@extropy/xp-formula` dep).
- `packages/contracts/src/types.ts` (documents field semantics; adds
  `T_FLOOR_DEFAULT`; marks `IrreducibleXPInputs` `@deprecated`).
- `packages/github-parasite/` (new scaffold).
- `docs/NORMALIZATION.md`, `docs/NON_EXTRACTION.md`,
  `docs/PROTOCOL.md`, `docs/REJECTED_FRAMINGS.md` (new).

---

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
## v3.1.1 — 2026-05-06 (Session update)

### Verified
- **Happy path integration test passes 12/12.** Full event cascade confirmed end-to-end:
  `POST /claims → claim.submitted → loop.opened → claim.decomposed → task.created×3 → task.assigned×3 → task.completed×3 → subclaim.updated×3 → claim.evaluated → loop.consensus_started → loop.closed → xp.minted.provisional → reputation.accrued → loop.settled`
- All 5 core services (epistemology-engine, signalflow, loop-ledger, reputation, xp-mint) compile cleanly under `noUnusedLocals` and `noUnusedParameters` strict mode.

### Bug fix
- **Epistemology Engine: verdict mapping.** `applyEvidence` only recognized `'confirmed'` as an affirmative verdict. Validators naturally emit `'supported'`. Both now map to confirmed in Bayesian update. Without this fix, all task completions were treated as falsifying evidence, driving posteriors to ~0.08 even when every validator agreed. Fix is in `packages/epistemology-engine/src/index.ts`.

### Infrastructure confirmed
- PostgreSQL 16 + Redis 7 stack fully operational under `docker compose up --build -d`.
- `scripts/init-db.sql` — per-service schemas with indexes, DAG edge table, event_log.
- `scripts/run-integration-test.py` — Python orchestrator for non-Docker local runs (starts all 5 services as managed subprocesses, runs 12 steps, tears down).
- `scripts/test-happy-path.sh` — shell equivalent for docker-compose deployment.

### API contracts locked (for 5 core services)
- `POST /validators` expects `{ name, type, domains }` — not `publicKey`.
- `POST /claims` expects `{ statement, domain, submitterId }` — not `content`.
- `GET /subclaims/by-claim/:claimId` — not `/claims/:claimId/subclaims`.
- Valid `EntropyDomain` values: `cognitive | code | social | economic | thermodynamic | informational`. Not `'physics'`.
- Task completion `verdict` field: `'confirmed' | 'supported'` both treated as affirmative.

### HomeFlow pilot
- `packages/homeflow/` scaffolded with full family pilot UI: setup wizard, household + member management, chores, recipes + meal plan, pantry, shopping list, dashboard.
- Google OAuth integration live. OAuth client: `192760521532-61naf99dc01rlj1c82bn95lv39js8rql`.
- `deploy-homeflow.sh` in repo root for VPS redeploy.
- `FAMILY_PILOT.md` documents the full pilot scope.

### Packages registered
- `packages/node-handshake/`, `packages/identity/`, `packages/psll-sync/`, `packages/quest-market/`, `packages/validation-neighborhoods/` added to npm workspaces in `package.json`.

---

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
