# Quest Marketplace (v3.1)

**Status:** First-class · New service: `quest-market/`

## Concept

Real-world signals ("lawn needs mowing," "trash on the road," "dog killing chickens") are translated locally by each user's personal AI into **micro-claims**, which are decomposed into **2–5 minute do-it-now quests**. Quests are published to the protocol, routed by SignalFlow, accepted by volunteers, and validated by neighborhood-sharded micro-validators.

## Quest schema

```
{
  id: UUID,
  claim_ref: ClaimID,
  duration_target: 2..5 minutes (default),
  geo: optional,
  skills_required: [SkillTag],
  reward_curve: EscalationCurveRef,
  state: PUBLISHED | ROUTING | ACCEPTED | SUBMITTED | VALIDATING | SETTLED | FAILED,
  proof_format: enum,
  created_by: PersonalAI_DID (ZKP),
  signed_psll_entry: hash
}
```

## Lifecycle

PUBLISHED → ROUTING → ACCEPTED → SUBMITTED → VALIDATING → SETTLED | FAILED

Validation handoff goes to `validation-neighborhoods/` for jury-duty 1/10th blind-slice review.

## Dynamic Reward Escalation (provisional)

Neglected quests automatically escalate potential XP until accepted.

- **Days 0–7:** linear 1.0× → 3.0×
- **Days 7+:** logarithmic to a hard cap of 10.0×
- All curve parameters governance-tunable.

## Routing (via SignalFlow)

4-factor weighting: domain match, reputation, current load, historical accuracy. Geo and skill filters layered on top. Cold-start volunteers get bootstrap weight (see `GAPS.md` #15).

## Examples

- "Lawn at 412 Oak" → 1 quest, ~30 min, geo-tagged.
- "Trash, mile marker 14" → 1 quest, ~5 min, photo proof.
- "Neighbor's dog killing chickens" → 4-quest decomposition: document → notify → mediate → escalate.

## Open gaps

See `GAPS.md`:
- Validator Selection #14–18 (P1)
- DFAO Governance #34–38 (P2)
- Performance #58 (SignalFlow routing latency targets)
