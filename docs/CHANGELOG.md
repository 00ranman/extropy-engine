# Changelog

## v3.1 — 2026-05-01 (Canonical)

### Vision
- Established **Digital Autarky** as the canonical framing: edge intelligence + protocol minimalism.

### Architecture
- **Removed** central `epistemology-engine` service. All claim decomposition is now performed locally by each user's personal AI.
- **Added** four new services: `identity/`, `psll-sync/`, `quest-market/`, `validation-neighborhoods/`.
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

### Housekeeping
- The previous file mislabeled `SPEC_v3.1.md` should be renamed `SPEC_v3.0_DEPRECATED.md`. The current `docs/SPEC_v3.1.md` is the official v3.1 spec.

## v3.0 — prior

Superseded. See `SPEC_v3.0_DEPRECATED.md` (when archived).
