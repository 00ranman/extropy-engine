# Changelog

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
