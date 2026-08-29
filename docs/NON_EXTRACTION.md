# Non-Extraction Invariant

Status: **architectural constraint.** Parallels [AUTARKY.md](../packages/xp-mint/docs/AUTARKY.md).

Version: canonical-v3.1.3.

Related: [PROTOCOL.md](./PROTOCOL.md), [NORMALIZATION.md](./NORMALIZATION.md), [SPEC_v3.1.md](./SPEC_v3.1.md), [cartel-threshold-analysis.md](./cartel-threshold-analysis.md).

## 1. The invariant

**Extropy tokens are non-transferable access thresholds. They are never balances to be extracted.**

Formally: there is no path in the protocol, at any layer, by which an actor converts an XP or CT balance into a claim on fiat, another cryptocurrency, or any external transferable value, whether directly or through wrapped, synthetic, derivative, or off-protocol side-market representations.

This is not a policy setting. It is an architectural invariant of the same order as Digital Autarky. If a feature can be added without breaking Autarky, and can be added without breaking Non-Extraction, it is allowed. If it breaks either, it is not shipped.

## 2. Why

Two failure modes are ruled out simultaneously by making the ledger non-extractive.

### 2.1 The Howey trap

Any token that is (a) purchasable, (b) transferable, and (c) held with the expectation of profit derived from others' work becomes a security under US case law. Every "just add a small liquid market" iteration of a protocol like this has ended in one of two places: it either registered as a security and became captured by the same intermediaries it was designed to route around, or it operated in the grey and eventually got shut down for it. The way out is not a better lawyer, it is a token that has no cash-out surface at all.

### 2.2 The Nash flip

The feedback loops in [SPEC_v3.1.md](./SPEC_v3.1.md) rest on a Signal equation whose equilibrium is honest signalling when the payoff for gaming is bounded by what the loop itself produces. The moment the loop's output can be sold outside the protocol, the payoff for gaming becomes the external market price, which is unbounded from the loop's perspective. That flips the equilibrium. Cartels form because the return on colluding to inflate ΔS scales with an out-of-loop price, not with in-loop access.

Both failure modes disappear if the token has no external price.

## 3. Access-economy semantics

Under Non-Extraction, XP and CT are not "how much I have" but "what I can currently do".

- **XP** is a stateful threshold. Above a threshold τ_action, the actor is admitted to a class of actions (validating in a domain, opening a loop of a given rarity, joining a validator neighborhood). Below τ_action, the action is not admitted. XP is not spent by taking the action.
- **CT** is a per-actor structural coefficient in the Signal equation. It shapes access weight in ties and vote weight in validation. CT is not spent by voting.
- **Consumption** is metered against a **contribution/draw ratio** ρ = ΔS_produced / ΔS_consumed, computed on the ledger itself. If ρ drifts below the domain-set floor, access degrades automatically. Restoration of ρ is itself a mintable loop.

The ratio ρ is what a fiat balance would have measured if we had one; the point of the architecture is that we do not need one to enforce reciprocity, because reciprocity is a property of the actor's own ledger history.

## 4. The three tests

Every proposed feature MUST pass all three tests before merge. This mirrors the AUTARKY five-test pattern.

### T1. Extraction test

*Can any actor convert an on-protocol balance into an off-protocol transferable value, directly or through a wrap?*

Concretely, look for:

- Any function that returns a signed message a third-party escrow could accept as proof of on-protocol balance.
- Any read-only endpoint whose output could be used as collateral in an external smart contract.
- Any governance action that transfers XP between actors without a loop being closed on the ledger.

If yes to any: T1 fails. The feature is rejected until the surface is closed or the feature is redesigned.

### T2. Counterparty test

*Does the feature introduce a stable second party whose sole role is to pay for XP or CT?*

Concretely, look for:

- Marketplaces where actor A always pays and actor B always earns for a fixed action type.
- Sinks-and-sources that map cleanly onto "consumer" and "producer" roles that persist across many loops.
- Prediction markets whose payout is denominated in tokens over loop outcomes (see §5).

If yes: T2 fails. The feature is redesigned so payoff flows track ΔS produced, not counterparty transfer.

### T3. Ratio test

*Does the feature preserve the contribution/draw ratio ρ as the primary throttle, or does it introduce a shortcut that lets an actor draw without proportionately producing?*

Concretely, look for:

- Delegated draw without delegated production.
- Grandfathered access that persists even when ρ falls below floor.
- Group-level pooling of ρ that hides individual free-riding.

If yes: T3 fails. The feature is redesigned so ρ remains an individual-level invariant with documented aggregation semantics.

## 5. Prediction markets over loop outcomes

Prediction markets are the canonical "just add a small liquid market" idea. Under Non-Extraction they are explicitly out of scope at the protocol layer.

Reason: a prediction market over ΔS outcomes raises the S(t) term in the Signal equation (see [SPEC_v3.1.md](./SPEC_v3.1.md) §Signal). That, combined with an external price, is exactly the Nash flip described in §2.2. It is also the single most requested feature; that is a signal that people want to extract, and the answer is no.

Domain-internal forecasting to help validators calibrate is not a prediction market for the purposes of this document. The distinguishing feature is whether the payoff is a transferable, tradable claim. Validator calibration payoffs that are non-transferable access thresholds are compatible with Non-Extraction and are covered by [SPEC_v3.1.md](./SPEC_v3.1.md).

## 6. Interaction with parasite / bridge integrations

Bridges to external systems (GitHub Apps, calendars, EHRs, appliances) are compatible with Non-Extraction as long as:

- The external system provides evidence, not payment.
- The reward for evidence is XP threshold movement, not a transferable claim.
- The bridge is one-way at the value layer: evidence in, no XP or CT out.

The GitHub App parasite in [packages/github-parasite](../packages/github-parasite/README.md) is designed under exactly these constraints.

## 7. What Non-Extraction is not

- It is not a claim that no one will ever try to build an off-protocol market in XP receipts. People will. The design goal is that such a market has no counterparty support inside the protocol, so it stays a fringe activity and never captures the equilibrium.
- It is not asceticism. Actors can convert access thresholds into real-world value all the time, by using them. What they cannot do is package unused access as a transferable claim.
- It is not a substitute for legal review. It removes the strongest known legal attack surface (Howey) but does not preempt all others.

## 8. Test coverage

Every module in `packages/xp-mint`, `packages/reputation`, `packages/loop-ledger`, and any new redemption package MUST include tests that exercise the three tests above against its public surface. See `packages/xp-mint/tests/non-extraction.test.ts` (to be added in the follow-up PR) for the canonical harness.
