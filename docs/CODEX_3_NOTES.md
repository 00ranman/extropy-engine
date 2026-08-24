# Codex 3.0 — capture notes

**Status:** Codex v2.1 stays frozen. Do not spin a new edition for this.
**Date:** 2026-08-23
**Why this file exists:** Several load-bearing mechanics keep falling out of the public story. They are in the type system. They are not in the Codex. Put them in 3.0.

---

## Two different clocks of death

Do not mash these together. 5%/month is **IT**, not XP.

| Thing | What it does | Code default (knob) |
| --- | --- | --- |
| **Settle window** | Time from provisional XP → standing XP | Thrown out as ~30 days. Could be 5, 10, 15, 40. Per-DFAO votable. Not scripture. |
| **Late burn** | Standing XP can still be destroyed | No expiry on burnability. Five days later or thirty years later. Nothing in the protocol says settled means immortal. |
| **XP decay** | Standing XP erodes on a schedule even with no dispute | `xpDecayRate` ρ = **0.01 per 30 loop cycles** (~1%/month). You keep working or the pile shrinks. Access economy: you do not spend XP; it gets eaten. |
| **IT decay** | Governance weight bleeds if you vanish | **~5%/month**. Anti-capture. Different token, different job. |

Possible axiom (not written yet): some XP and some IT always burn. Floor, not a vibe. Capture for 3.0 if we mean it.

Source in code: `packages/contracts/src/types.ts` — `TemporalDecayConfig`, `XPDecayConfig`. `docs/GOVERNANCE_DEFAULTS.md` had IT and the 30-day window; it omitted XP decay. That omission is the bug.

---

## Faces vs protocol (keep them un-scrambled)

- **LocalFlow** = errand face. Uber / Lyft / DoorDash / Grubhub, plus the car you do not have. Confirmation is a receipt. Not how ΔS is invented.
- **SignalFlow** = the protocol you talk to. Assistant you trust (cloud or local) + PSLL + evidence on the DAG. Proposes provisional ΔS. You do not type in a score.
- **PSLL** = Personal Signed Local Log. Yours. Mesh gets receipts, not the diary.
- **Digital Autarky** = intelligence and identity at the edge. Company login = company tether. Own hardware = the actual privacy path. A network-hosted model is a later idea, not a product.

---

## ΔS is a proxy

Open to a constant for “mowing a lawn.” Do not expect one. Words drift. Freezing a number and calling it physics is often an ontological sleight of hand.

Start crude. Fine-tune as data arrives (duration, before/after, gas vs the alternative, ozone, idle). `w · E` is where those terms live. MICRO overselling is real. SignalFlow + evidence + late burn is how we live with it — not a claim that people will not try.

---

## Votes stay in the room

A vote rewrites the DFAO it is cast in (settle window, decay, quorum). It does not rewrite the mesh. **PLANETARY** is the only room that hits everyone, and that is supposed to be hard.

DFAO = Decentralized Fractal Autonomous Organization. NANO → MICRO → MESO → MACRO → PLANETARY are **labels for suggested rule-sets**, not headcount fences. Seven is not a law.

---

## Node box

Intended product, later. For-profit. Not a 501(c) — that paperwork is more entropy than it saves. Surplus after salary and keeping the lights on goes into R&D and nodes (including where people actually need them), maybe later compute you can run a model on without owning the rack. Not shipping. Clone-the-repo is not the product.

---

## Canonical mint (do not let glossary drift rewrite this)

```
XP = R × F × ΔS × (w · E) × log(1/Tₛ)
```

R = rarity of the action class, **not** reputation.
F = frequency-of-decay, **not** falsifiability.
Floor: `XP ≥ ΔS / cₗ²` — structural analogy, not a new physics law.
Lives in `packages/xp-formula`. No reimplementations.

---

## What 3.0 should actually decide

1. Name the settle-window default and say it is a knob.
2. Put XP decay on the page next to IT decay, with different rates.
3. State late-burn explicitly: settled ≠ immortal.
4. Keep LocalFlow / SignalFlow / PSLL / Autarky as separate nouns.
5. Decide whether a burn-floor axiom exists.
6. Leave 2.1 alone until that list is actually written.
