# Provisional Defaults — All Governance-Tunable

**Status:** v3.1 ships with concrete defaults so the system has shape. Every value below is explicitly votable from day one via DFAO conviction voting.

## Knobs

| Knob | v3.1 default | Tier to vote | Notes |
|---|---|---|---|
| ZKP scheme | BBS+ | Ecosystem | zk-SNARKs allowed for advanced use |
| Identity reveal threshold | 7-of-12 + cause-shown | Ecosystem | See `IDENTITY.md` |
| Reward escalation curve (early) | linear 1.0× → 3.0× over 7d | Domain DFAO | Per-domain customization allowed |
| Reward escalation curve (late) | log to cap 10.0× | Domain DFAO | Hard cap governance-tunable |
| Retroactive validation window | 30 days | Ecosystem | Burn cascade rules apply |
| IT decay | 5%/month | Ecosystem | Anti-capture pressure |
| CT lockup | 14 days | Ecosystem | Limited transferability |
| EP decay | TBD | Ecosystem | Pending Phase 2 modeling |
| GT decay | TBD | Ecosystem | Pending Phase 2 modeling |
| Conviction voting half-life | TBD per tier | Per-DFAO | Tunable by tier |
| Validator weight factors | 4 (domain, rep, load, accuracy) | Ecosystem | Weights themselves tunable |
| PSLL anchor cadence | 1 per loop close | Ecosystem | See `PSLL.md` |
| Quorum size formula | TBD | Domain DFAO | See `GAPS.md` #1 |
| Cartel detection threshold | TBD | Ecosystem | See `GAPS.md` #2, #8 |
| Skill DAG progression criteria | TBD | Domain DFAO | Phase 3 |

## How to change a default

1. Personal AI drafts a proposal targeting the relevant tier.
2. Proposal enters conviction voting in the appropriate DFAO.
3. On passage, the new value is written to `governance/` and propagated.
4. PSLL records the proposal trail end-to-end.

## Principle

Defaults exist so the system runs. Defaults are not sacred. Goodhart pressure on any default is treated as diagnostic fuel for refinement, not a fatal flaw.
