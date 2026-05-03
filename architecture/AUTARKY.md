# Digital Autarky — Architectural Vision

**Status:** Canonical (v3.1)
**Authority:** This document is the source of truth for the Digital Autarky principle. Any implementation decision conflicting with it is wrong.

---

## The principle in one sentence

Every participant remains sovereign over their own intelligence stack, identity material, decision context, and local event history. The network is a coordination and accounting layer, not a supermind.

## Why this principle exists

Centralized intelligence becomes a hidden control point. A network that "decomposes reality" on behalf of its users — even with the best intentions — eventually shapes what users perceive, what they can claim, and what counts as valid. That control surface is the failure mode every prior coordination platform has converged toward, regardless of starting ideology.

The Extropy Engine refuses that surface. Not as a stylistic choice. As a structural commitment.

## What sovereignty means here

| Layer | Who controls it |
|---|---|
| Personal AI / model selection | The participant |
| Local raw context (private logs, sensors, observations) | The participant |
| Identity material (KYC artifacts, biometric bindings) | The participant's device |
| Decision history (PSLL) | The participant |
| Claim formulation (decomposition into actionable units) | The participant's personal AI |
| Submitted claim payload (what the network sees) | Designed to be the minimum interoperable surface |
| Validation outcomes | The mesh, via incentive-aligned peer review |
| Receipts and DAG entries | The shared network (immutable, public) |

## What the network is allowed to do

- Standardize claim and quest schema
- Route claims to validators via SignalFlow
- Operate the validation lifecycle (volunteer micro-slices, validator nodes)
- Mint, burn, and settle XP via the canonical formula
- Record receipts to the DAG
- Aggregate and surface emergent epistemology (`epistemology-engine`)
- Enforce shared protocol rules (anti-Sybil, governance thresholds, decay)

## What the network is NOT allowed to do

- Decide what a participant meant by their input
- Decompose claims for users
- Hold a private world model over participants
- Require raw PII or full local logs
- Operate a "central brain" that the rest of the system depends on
- Establish a single source of epistemic authority

## The personal AI handshake

The handshake between participant and network has a fixed shape:

```
[Personal AI] --(Claim Package)--> [Network]
[Personal AI] <--(Routing + Validation Receipt)-- [Network]
```

The Claim Package contains:

- A schema-conformant claim (domain vector E, falsifiability score F, ΔS estimate, evidence pointers)
- An identity proof (ZKP from the Identity layer)
- A PSLL anchor reference (Merkle commitment, not raw log)
- Optional quest-market metadata (if claim originates from an accepted quest)

What the Network does NOT receive:

- Raw conversational context with the personal AI
- Full PSLL contents
- Identity material beyond what the ZKP proves
- Decomposition reasoning (only the resulting claim)

## How this plays with the epistemology engine

The redefined `epistemology-engine` (see `docs/SPEC_v3.1.md` §13.4) does not violate Autarky because it is read-mostly. It indexes public mesh state (DAG entries, reputation graph, validation outcomes) — never private context. It does not decide truth; it surfaces what the mesh has already decided. Multiple instances of the engine can run independently, and there is no canonical authoritative instance.

This is the difference between a *witness* and an *arbiter*. The engine is a witness.

## How this plays with identity

The Identity layer is the strongest test of Autarky. It must establish enough about a participant for the network to enforce uniqueness and accountability, while exposing nothing about the participant beyond what those guarantees require.

The hybrid model (OAuth + on-device KYC + DID + ZKP) is the v3.1 answer:

- KYC happens on-device. The network never sees the documents.
- DID is generated locally. The network sees a public key.
- ZKPs (BBS+ default) prove the claims the network needs (uniqueness, valid onboarding, governance eligibility) without revealing what backs them.
- Per-context nullifiers prevent cross-context correlation.
- Reveal under governance threshold is escrowed (provisional 7-of-12 ecosystem-validator threshold key).

See [`docs/IDENTITY.md`](../docs/IDENTITY.md).

## How this plays with PSLL

The Personal Signed Local Log lives on the participant's device. It is the participant's record of their own activity — claims submitted, validations performed, quests accepted, decompositions made.

The network never ingests PSLL contents. It receives only periodic Merkle-root commitments anchored into the DAG. Under dispute, selective ZKP-based disclosure can prove inclusion without exposing the rest of the log.

See [`docs/PSLL.md`](../docs/PSLL.md).

## Tests for whether a design respects Autarky

Before any new feature ships, it must pass these tests:

1. **The brain test.** Does this feature put intelligence into a network service that should belong at the edge? If yes, redesign.
2. **The capture test.** If a hostile actor controlled this feature, what could they do? If they could shape what users perceive, redesign.
3. **The leak test.** Does the feature require participants to send raw context, raw identity, or full local state? If yes, redesign.
4. **The exit test.** Can a participant leave the network and keep their full local state and history? If no, redesign.
5. **The replay test.** If the network shut down tomorrow, could the entire epistemic state be reconstructed from the DAG and public reputation graph alone? If no, the design depends on private network state and is suspect.

## What Autarky is not

- Not anti-coordination. The network exists to coordinate.
- Not anti-validation. Peer review is the heart of the system.
- Not anti-accountability. Identity binding and reveal-under-governance are real.
- Not anti-AI. Personal AI is required, not forbidden.
- Not isolationism. Participants can opt into deeper sharing voluntarily; the default is sovereign.

## Status

Autarky is the design constraint that the rest of the v3.1 architecture must satisfy. It is not a feature to be added later. It is the shape of the architecture itself.
