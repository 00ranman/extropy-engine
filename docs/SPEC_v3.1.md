# Extropy Engine — Technical Specification v3.1

**Status:** Canonical
**Supersedes:** v3.0 (formerly mislabeled v3.1)
**Date:** 2026-05-01
**Maintainer:** 00ranman
**License:** MIT

---

## 0. What's New in v3.1

- Removed central `epistemology-engine`. Decomposition is local to each user's personal AI.
- Hybrid identity layer (OAuth + on-device KYC + ZKP DID) is mandatory.
- Personal Signed Local Log (PSLL) is mandatory per node.
- Micro-quest marketplace + dynamic reward escalation are first-class.
- Native substrate decision is final; three Holochain patterns borrowed and renamed.
- Volunteer micro-validation (1/10th blind slices) is the default validation primitive.
- All provisional defaults are explicitly governance-tunable from day one.

## 1. Core Vision — Digital Autarky

Every participant is sovereign over their own AI (single model or local multi-model consensus) running on their own hardware. The Extropy protocol is the minimal standardized handshake plus a shared immutable causal DAG. There is no central AI, no central epistemology engine, no single point of decomposition or control.

Goal: verifiable coordination and accountability without surrendering personal sovereignty.

## 2. Personal AI + Handshake Model

**Edge (personal AI):**
- Translates real-world signals into micro-claims.
- Decomposes claims into 2–5 minute do-it-now quests.
- Maintains the user's Personal Signed Local Log (PSLL).
- Holds DID + ZKP credentials. Never exports raw identity.

**Protocol (shared):**
- Common claim-submission language.
- SignalFlow routing (reputation + skills + location + load).
- Volunteer micro-validation (jury-duty 1/10th blind slices).
- Dynamic reward escalation.
- Loop lifecycle, provisional XP minting, retro validation/burn, reputation, DAG.

Hard rule: all reasoning, prioritization, and decomposition happens at the edge.

## 3. Identity & Accountability Layer (Mandatory)

1. OAuth/OpenID local sign-in (Google, Apple, email, phone).
2. One-time on-device KYC binding (ID + biometric or trusted issuer).
3. Personal AI generates DID + Verifiable Credential, wrapped in ZKP (BBS+ default).
4. DAG sees ZKP proof + per-context nullifier. No raw PII anywhere.

Governance reveal: threshold-keyed escrow. Provisional 7-of-12 ecosystem validators + cause-shown proposal. Governance-tunable.

## 4. Operational Model — Micro-Quest Marketplace

Real-world signal → personal AI → micro-claim(s) → 2–5 min quest(s) → SignalFlow routes by {reputation, skills, location, demand} → volunteer accepts → submits proof → 1/10th blind-slice validators verify → loop lifecycle → provisional XP → retroactive settle/burn → DAG record.

Dynamic Reward Escalation (provisional): linear 1.0× → 3.0× over 7 days, then logarithmic to a cap of 10.0×. Governance-tunable.

## 5. Substrate & Architecture — Final

Native substrate. Built end-to-end. Not a hApp on Holochain or any other framework.

Borrowed patterns (re-implemented natively):

| Pattern source | Extropy-native name | Purpose |
|---|---|---|
| Holochain source chain | Personal Signed Local Log (PSLL) | Per-node provenance + audit |
| Holochain neighborhood DHT | Validation Neighborhoods | Sharded volunteer micro-validation |
| Holochain zomes / DNA | Rule Modules | Composable fractal DFAO rules |

### Service map (v3.1)

`contracts` · `xp-formula` · `loop-ledger` · `signalflow` · `xp-mint` · `reputation` · `dag-substrate` · `dfao-registry` · `governance` · `token-economy` · `temporal` · **`identity` (NEW)** · **`psll-sync` (NEW)** · **`quest-market` (NEW)** · **`validation-neighborhoods` (NEW)** · ~~`epistemology-engine`~~ (REMOVED — moved to edge personal AI).

## 6. XP Formula (Canonical)

```
XP = R × F × ΔS × (w · E) × log(1 / Tₛ)
```

Single source of truth: `packages/xp-formula/src/index.ts`. No forks.
Conceptual form `XP = ΔS / c_L²` retained in companion papers.

## 7. Loop Lifecycle

OPEN → VALIDATING → CONSENSUS → CLOSED → SETTLED (or FAILED / ISOLATED).
Provisional mint at CLOSE. 30-day retro window. Final settle: confirm or burn. Wrong validators lose reputation.

## 8. 8 Entropy Domains

Cognitive · Code · Social · Economic · Thermodynamic (anchor) · Informational · Governance · Temporal. Each has its own measurement protocol, instrument, failure modes, and falsification condition. Miscalibrated instruments are replaced.

## 9. Token Economy

| Token | Transferable | Decay | Purpose |
|---|---|---|---|
| XP | No | None | Reputation |
| IT | No | 5%/month | Influence |
| CT | Limited (14d lockup) | TBD | Coordination |
| EP | No | TBD | Epistemic stake |
| GT | Limited | TBD | Governance |
| RT | Yes | None | Routine utility |

## 10. Personal Signed Local Log

See `PSLL.md`. Append-only, hash-chained, Ed25519-signed. Only Merkle-root receipts anchor to DAG via `psll-sync`.

## 11. DFAO Governance

Fractal MICRO (2–7) → ECOSYSTEM (1000+). Conviction voting + quorum + automatic execution. Influence decays. All provisional defaults explicitly votable.

## 12. Phase Status

Phase 1 complete (~15–20%). Phase 1.5 (v3.1 deltas) in progress. Phase 2 = org layer + retro-validation at scale. Phase 3 = oracle + skill DAG. Phase 4 = ecosystem maturity.

## 13. Known Open Gaps

63 open engineering gaps across 13 categories — see `GAPS.md`.

## 14. Companion Specs

`IDENTITY.md` · `PSLL.md` · `QUEST_MARKET.md` · `GOVERNANCE_DEFAULTS.md` · `GAPS.md` · `CHANGELOG.md`
