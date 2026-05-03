# Changelog

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
