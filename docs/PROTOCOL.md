# Extropy Protocol v0.1

Status: **implementation-agnostic protocol spec.** Deliberately separate from the TypeScript reference implementation in this repo. If it is in this document, an alternative implementation in any language can conform to it. If it is only in the reference impl, it is not part of the protocol yet.

Version: 0.1 (2026-07). Aligns with formula version `canonical-v3.1.3`.

Constraints inherited (mandatory):

- [Digital Autarky](../packages/xp-mint/docs/AUTARKY.md)
- [Non-Extraction](./NON_EXTRACTION.md)
- [Cross-Domain ΔS Normalization](./NORMALIZATION.md)

Related: [SPEC_v3.1.md](./SPEC_v3.1.md) is the internal Codex; PROTOCOL.md is the external contract.

## 1. Scope

This document defines what an implementation MUST do to be Extropy-compatible. It does not define how. It says nothing about database engines, message buses, programming languages, or transport.

## 2. Roles

### 2.1 Actor

An entity that can open loops, close loops, hold XP thresholds, hold CT, and be observed by validators. Identity is out of scope for v0.1 beyond requiring that each actor has a stable identifier that survives across sessions and is verifiable by a DID method or equivalent. See §10.

### 2.2 Validator neighborhood

A set of actors above a per-domain XP threshold τ_validator_d, who observe evidence submitted for a loop closure and produce independent verdicts. Neighborhoods are per-domain and per-loop. No actor is a validator "in general".

### 2.3 Substrate

The layer that records loop state, validator verdicts, and formula-version-stamped mint events. Substrate implementations MUST be append-only at the event layer and MUST expose the mint-event log to any actor.

## 3. Loop lifecycle

A loop passes through the following states, in order, with no retro-mutation:

```
proposed → open → evidence-submitted → validator-verdicts-collected → closed | rejected
                                                                        ↓
                                                                     minted → confirmed | burned
```

Each state transition is a substrate-recorded event. Timestamps are wall-clock but not authoritative for XP; the authoritative time input is `elapsed_seconds = t_close - t_open` measured at substrate resolution.

## 4. Evidence

Every loop closure MUST carry evidence that:

- **E1.** Independently reproducible by any validator in the neighborhood, without contacting the actor.
- **E2.** Domain-native. The domain's measurement operator M_d (see [NORMALIZATION.md](./NORMALIZATION.md) §3) applied to this evidence yields ΔS_bₑ within tolerance ε_d.
- **E3.** Tamper-evident. A validator can detect if the evidence has been modified between submission and verdict.

Implementations are free to use content-addressed storage, signed attestations, or on-chain hashes to satisfy E3. The protocol requires only that E3 holds.

## 5. Validator verdicts

Each validator in the neighborhood emits a verdict:

```
verdict = { validator_id, deltaS_measured, decision ∈ {accept, reject, abstain}, evidence_hash }
```

- **V1.** Accept iff `|deltaS_measured - deltaS_claimed| ≤ ε_d`.
- **V2.** Reject iff the difference exceeds ε_d **or** any of E1–E3 fails.
- **V3.** Abstain iff the validator lacks the sub-domain competency to score this loop.

Abstentions do not count in the closure quorum but MUST be recorded so that validator drift and coverage gaps are observable.

## 6. Closure

A loop closes when:

- The number of `accept` verdicts satisfies the domain's quorum function Q_d(N_participating).
- No `reject` verdict from a validator in the top decile of the neighborhood by CT stands unrebutted after the domain's rebuttal window.
- All accepts agree on ΔS within ε_d.

The mint uses `ΔS_final = median(deltaS_measured over accepts)`. Median is used, not mean, so that a single outlier accept cannot inflate the mint.

## 7. Mint

On closure, the substrate mints XP according to:

```
XP = R × F × ΔS_final × (w · E) × min(log(1/Tₛ), log(1/T_floor))
Tₛ = exp(-λ_d · elapsed_seconds)
```

with:

- R = domain rarity coefficient (governance-tunable).
- F = frequency-of-decay penalty for this actor's recent same-class loops.
- w, E = domain weight and essentiality vectors.
- λ_d = per-domain settlement-decay constant.
- T_floor = governance-set floor, default 0.01.

The formula version stamped on the mint event MUST match the formula version the substrate is running. Formula-version drift between the stamp and the executed math is a critical bug and MUST fail closed.

**X_d provenance precondition.** For any convention-tier domain (see [EMERGENT_EXCHANGE_RATES.md](./EMERGENT_EXCHANGE_RATES.md)), the mint reads ΔS through an explicit emergent exchange coefficient X_d, and MUST resolve a valid rate record for that domain and epoch before minting. A rate record is valid only if it carries domain, rate value, uncertainty, evidence provenance, epoch, version, and last-corroborated reference. If provenance is missing, incomplete, or expired past its corroboration horizon, the mint MUST fail closed. There is no default rate and no silent fallback.

Distribution: XP is distributed to validators in proportion to their contribution to closure, and to the actor as loop opener. The exact split is a governance parameter but MUST NOT be zero for validators (that would kill validator incentive) nor zero for the actor (that would kill loop-opener incentive).

## 8. Non-transferability

XP and CT are **stateful access thresholds**, not balances. Concretely:

- **N1.** No protocol operation transfers XP between two actors as a first-class action.
- **N2.** No protocol operation exchanges XP for anything transferable.
- **N3.** Access thresholds are the only sanctioned mechanism for using accumulated XP.

Reciprocity is metered on the substrate itself via the contribution/draw ratio ρ (see [NON_EXTRACTION.md](./NON_EXTRACTION.md) §3). If ρ drops below the domain floor ρ_min_d, the actor's admitted actions in that domain contract automatically. Restoration of ρ is itself a mintable loop class.

## 9. Retroactive validation and burn

Mints are provisional until a retroactive-validation window closes. During that window:

- Any validator (not just the original neighborhood) can submit a challenge.
- A challenge that produces a rebuttal accepted by ≥ Q_d validators burns the mint. Distribution is reversed. The formula-version stamp is retained so an audit can distinguish burns of legitimate mints (from ambient noise) from burns of gamed mints.

Retroactive confirmation follows the same mechanism in reverse: a provisional mint that survives its window with no accepted challenge is confirmed and its XP is committed to the actor's thresholds.

## 10. Identity

v0.1 requires:

- **I1.** Actor identifiers are stable across sessions.
- **I2.** Two identifiers referring to the same natural / legal person are recognizably related by an on-substrate mechanism, so that Sybil load can be estimated.
- **I3.** The identifier space is compatible with W3C DID; a DID-shaped identifier MUST resolve without an out-of-band lookup.

I2 does not require a mapping to legal identity. It requires only that Sybil clusters are visible to governance.

## 11. Governance parameters

The parameters listed below are governance-tunable per domain. Each has a default, listed in [GOVERNANCE_DEFAULTS.md](./GOVERNANCE_DEFAULTS.md).

- R_d (rarity coefficient)
- λ_d (settlement-decay constant)
- T_floor (settlement-time floor)
- Q_d (quorum function)
- ε_d (verdict tolerance)
- τ_validator_d, τ_action_d (access thresholds)
- ρ_min_d (contribution/draw floor)
- retroactive validation window length

Changes to these parameters MUST themselves close as loops in the `governance` domain, and MUST NOT retro-apply to already-confirmed mints.

**Rate repricing is a governed loop.** Adjusting a convention-tier exchange coefficient X_d is not a routine mint operation. It closes as a high-rarity, broad-validator-neighborhood, quorum-gated, reversible loop, bounded per epoch by a velocity limit v_d, using evidence independent of any XP computed from the same X_d. If drift outruns independent corroboration, if evidence density falls below the declared minimum, or if repricing closes faster than independent confirmation, minting in that domain MUST halt and X_d MUST revert to its last corroborated value. The parameters X_d, v_d, epoch length, uncertainty thresholds, evidence-density minimums, and repricing quorum are governance-tunable and are specified in [EMERGENT_EXCHANGE_RATES.md](./EMERGENT_EXCHANGE_RATES.md). No numeric defaults are set for them in this release.

## 12. Conformance

An implementation is **Extropy-conformant** if it:

- Implements §3–§9 correctly.
- Ships a domain measurement operator M_d for at least one domain that satisfies [NORMALIZATION.md](./NORMALIZATION.md) §4.
- Passes the three tests in [NON_EXTRACTION.md](./NON_EXTRACTION.md) §4 against its full public surface.
- Publishes its formula version and refuses to run mints if the formula version and the stamped version disagree.

## 13. Non-goals for v0.1

- Fiat bridges. Ruled out permanently by Non-Extraction.
- Cross-substrate migration. A future v0.2 concern.
- Prediction markets over loop outcomes. See [NON_EXTRACTION.md](./NON_EXTRACTION.md) §5.
- Any tradable token wrapper.

## 14. Change log

- v0.1 (2026-07): initial public draft, aligned with formula `canonical-v3.1.3`.
