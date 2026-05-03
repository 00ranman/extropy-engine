# Quest Marketplace — QUEST_MARKET.md

**Packages:** [`packages/quest-market`](../packages/quest-market), [`packages/validation-neighborhoods`](../packages/validation-neighborhoods)
**Spec parent:** [`docs/SPEC_v3.1.md`](./SPEC_v3.1.md) §10
**Status:** Skeleton; specification frozen for v3.1

## What it is

A first-class operational primitive: a living marketplace of micro-quests with dynamic reward escalation. The default unit of work is small, fast, and verifiable. The marketplace makes contribution legible.

## Why micro

Contribution economies fail when contribution units are too vague, too large, or too slow to verify. The 2–5 minute default task grain makes:

- Onboarding low-friction (anyone can start with a 3-minute task)
- Validation tractable (volunteer slices stay small)
- Coordination meaningful (claims close fast enough to feel real)
- Gaming expensive (small per-unit rewards mean farming costs scale)

Larger work composes from micro-quests. A complex task is a graph of small ones.

## Lifecycle

```
[Real-world input]
        │
        ▼ Personal AI mediation
[Structured micro-claim]
        │
        ▼ Decomposition into 2–5 min tasks
[Micro-quest published to marketplace]
        │
        ▼ SignalFlow routing (reputation × skill × location × demand × DFAO policy)
[Quest accepted by participant]
        │
        ▼ Work performed
[Completion submitted with evidence]
        │
        ▼ Volunteer micro-validation (1/10th blind slices)
[Weighted consensus → loop closure]
        │
        ▼ XP minted (provisional)
[Retroactive validation window]
        │
        ▼ Settle or burn
[Final XP credited or revoked]
```

## Dynamic reward escalation

Neglected work automatically gets higher reward weight until accepted. Provisional curve:

- **Days 0–7:** linear escalation from 1.0× to 3.0× base XP weight
- **Days 7+:** logarithmic escalation, capped at 10.0× base XP weight
- Decays back to 1.0× once work is in progress

Governance-tunable per DFAO.

## Validator routing (SignalFlow)

Each quest is routed based on a four-factor signal:

```
score = w_d × domain_match
      + w_r × reputation
      + w_l × current_load_inverse
      + w_a × historical_accuracy
```

Default weights `(w_d, w_r, w_l, w_a)` provisional `(0.35, 0.30, 0.15, 0.20)`. Per-DFAO override allowed.

## Volunteer micro-validation

Default: validators see a **1/10th blind slice** of a claim. Aggregation across slices produces F (falsifiability score). Benefits:

- Single-validator influence is diluted
- Privacy is preserved (no validator sees the full context)
- Goodhart-resistance improves (gaming requires coordinated capture across many validators)
- Accessibility increases (1/10th of a small claim is a sub-minute task)

Validator nodes (full-context validation) remain supported for high-stakes or low-decomposability claims.

## Marketplace UX expectations

The marketplace must surface to a participant:

- **Quests near me** (geographic / contextual proximity)
- **Quests in my skill profile** (matched on declared and demonstrated capabilities)
- **Quests with escalated reward** (the "neglected work" carrot)
- **Validation tasks** (sub-minute slices available right now)
- **My history** (PSLL-backed; what I've accepted, completed, validated)
- **Reputation feedback** (per-domain scoring; decay-aware)

## Anti-abuse

- **Decomposition checks.** Claims that cannot be decomposed below threshold task size are flagged.
- **Throughput rate-limiting.** Per-participant velocity caps prevent farming bursts.
- **Reputation-gated escalation.** Acceptance of escalated-reward quests requires minimum domain reputation.
- **Cross-validation correlation.** Validators whose scoring correlates suspiciously closely are flagged via the epistemology engine's Sybil-cluster surfacing.

## Open questions

- Bootstrap density: does the marketplace work below N participants? (provisional N=1000 per DFAO)
- Geographic coverage: how does routing degrade in low-density areas?
- Cross-DFAO quest mobility: when can a quest from one DFAO be fulfilled by a participant primarily in another?
- Escalation cap: 10× is provisional and may be too high for stable economies
- Compensation model: pure XP vs XP+CT mix per-quest

Tracked in [`docs/GAPS.md`](./GAPS.md).
