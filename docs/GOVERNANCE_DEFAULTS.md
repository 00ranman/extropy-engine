# Provisional Defaults — All Governance-Tunable

**Status:** v3.1 ships with concrete defaults so the system has shape. Every value below is explicitly votable from day one via DFAO conviction voting. Votes rewrite the DFAO they are cast in. Only PLANETARY hits the mesh.

See `docs/CODEX_3_NOTES.md` for the Codex 3.0 capture of mechanics that kept falling out of the public story.

## Knobs

| Knob | v3.1 default | Tier to vote | Notes |
|---|---|---|---|
| ZKP scheme | BBS+ | Ecosystem | zk-SNARKs allowed for advanced use |
| Identity reveal threshold | 7-of-12 + cause-shown | Ecosystem | See `IDENTITY.md` |
| Reward escalation curve (early) | linear 1.0× → 3.0× over 7d | Domain DFAO | Per-domain customization allowed |
| Reward escalation curve (late) | log to cap 10.0× | Domain DFAO | Hard cap governance-tunable |
| Retroactive **settle** window | ~30 days (starting number) | Per-DFAO; PLANETARY to hit everyone | Time from provisional XP → standing XP. Could be 5, 10, 15, 40. Not scripture. |
| Late burn | no expiry | Ecosystem / dispute path | Standing XP can still burn years later. Settled ≠ immortal. |
| **XP decay** ρ | **0.01 per 30 loop cycles (~1%/month)** | Per-DFAO | Not 5%. That is IT. Access economy: you do not spend XP; it gets eaten. You keep working or the pile shrinks. |
| IT decay | 5%/month | Per-DFAO | Anti-capture pressure. Different token, different job. |
| CT lockup | 14 days | Ecosystem | Limited transferability |
| EP decay | TBD | Ecosystem | Pending Phase 2 modeling |
| GT decay | TBD | Ecosystem | Pending Phase 2 modeling |
| Conviction voting half-life | TBD per tier | Per-DFAO | Tunable by tier |
| Validator weight factors | 4 (domain, rep, load, accuracy) | Ecosystem | Weights themselves tunable |
| PSLL anchor cadence | 1 per loop close | Ecosystem | See `PSLL.md` |
| Quorum size formula | TBD | Domain DFAO | See `GAPS.md` #1 |
| Cartel detection threshold | TBD | Ecosystem | See `GAPS.md` #2, #8 |
| Skill DAG progression criteria | TBD | Domain DFAO | Phase 3 |
| Burn-floor axiom | **not written** | PLANETARY if we mean it | Possible: some XP and some IT always burn. Capture for Codex 3.0. |

## How to change a default

1. Personal AI / SignalFlow drafts a proposal targeting the relevant DFAO.
2. Proposal enters conviction voting in that DFAO.
3. On passage, the new value is written to `governance/` and propagated.
4. PSLL records the proposal trail end-to-end.
5. A MICRO vote does not rewrite PLANETARY knobs.

## Principle

Defaults exist so the system runs. Defaults are not sacred. Goodhart pressure on any default is treated as diagnostic fuel for refinement, not a fatal flaw.
