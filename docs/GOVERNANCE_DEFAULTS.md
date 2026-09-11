# Provisional Defaults — All Governance-Tunable

**Status:** v3.5 ships with concrete defaults so the system has shape. Every value below is explicitly votable from day one via DFAO conviction voting. Votes rewrite the DFAO they are cast in. Only PLANETARY hits the mesh.

Canonical tables and who-may-change: [`docs/DEFAULTS.md`](./DEFAULTS.md). Engineering parent: [`docs/SPEC_v3.5.md`](./SPEC_v3.5.md) §24.

See `docs/CODEX_3_NOTES.md` for the Codex 3.0 capture of mechanics that kept falling out of the public story. Capture notes are not a newer Codex.

## Knobs

| Knob | v3.5 default | Tier to vote | Notes |
|---|---|---|---|
| ZKP scheme | BBS+ (signatures today) | Ecosystem | zk-SNARKs allowed for advanced use. Circuits are not in Codex 2.1. |
| Identity reveal threshold | 7-of-12 + cause-shown | Ecosystem | See `IDENTITY.md`. Looking is a vertex. |
| Reward escalation curve (early) | linear 1.0× → 3.0× over 5d | Domain DFAO | One 5-day week. Per-domain customization allowed |
| Reward escalation curve (late) | log to cap 10.0× | Domain DFAO | Hard cap governance-tunable |
| Late burn | no expiry | Ecosystem / dispute path | Close mints. Burn anytime. No settle window. Settled-as-final is dead. |
| **XP decay** keep | **0.99 every 10 days (~1% of remaining)** | Planetary | Access economy: you do not spend XP; it gets eaten. n is idle 10-day counts. |
| **CT idle leak** | Same keep as XP | Planetary | Idle on web W. A close / till spark / posted task on W resets n. CT does not travel. |
| **H window** | 10 days | Planetary | Auto H_cap and training. Two 5-day weeks of signed cash. Not the leak tick. Not a verification of the lawn. |
| H_cap | Auto from signed cash | This house | No slider. No Off on the register. Training remainder 0 until the window fills. |
| λ | 0.15 | Web W | 10-day notice. EP = XP · L + λ · L. |
| IT | clip(H_gov · S_gov · κ · CT_W · β_gov, 0, 1) | This room | No pile. Burns in the tally. H_gov = 0 is one DID one nullifier. Not a 5%/month bag. |
| Conviction voting half-life | TBD per tier | Per-DFAO | Tunable by tier |
| Looker weight factors | 4 (domain, accuracy, load, history) | Ecosystem | Weights themselves tunable. No validator class. |
| PSLL anchor cadence | 1 per loop close | Ecosystem | See `PSLL.md` |
| Quorum size formula | TBD | Domain DFAO | See `GAPS.md` |
| Cartel detection threshold | TBD | Ecosystem | See `GAPS.md` |
| Skill DAG progression criteria | TBD | Domain DFAO | Phase 3 |
| Burn-floor axiom | **not written** | PLANETARY if we mean it | Possible: some XP and some IT always burn. Capture for Codex 3.0. Do not implement here. |

**Dead knobs (do not restore):** CT lockup, GT decay, EP as a decaying bag, transfer friction δ, six-token counts, settle window / two-phase mint as epistemology, 30-day anything, 40-day anything, months. CT is not transferable. EP dies in the sale. GT is a dead letter. Close mints. Burn anytime. Calendar is 5-day weeks.

## How to change a default

1. Personal AI / SignalFlow drafts a proposal targeting the relevant DFAO.
2. Proposal enters conviction voting in that DFAO.
3. On passage, the new value is written to `governance/` and propagated.
4. PSLL records the proposal trail end-to-end.
5. A MICRO vote does not rewrite PLANETARY knobs.
6. Unplug is how overlay stops. That is not a cashier button.

## Principle

Defaults exist so the system runs. Defaults are not sacred. Goodhart pressure on any default is treated as diagnostic fuel for refinement, not a fatal flaw. Lose-conditions (cash-out, silent DAG rewrite, silent mapper mutation) are ℱ, not knobs.
