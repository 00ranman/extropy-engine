# Codex 3.0 — play, cosmetics, seasons, roles

**Status:** Codex v2.1 stays frozen.
**Date:** 2026-08-23
**Companions:** `CODEX_3_NOTES_ACCESS.md` (ZKP bands), `CODEX_3_NOTES.md`

Three layers. Do not mash them.

| Layer | Job | Public? | Can it steer the mesh? |
| --- | --- | --- | --- |
| **Access band** | ZKP on decayed XP. Gate a till / a DFAO door. | Default **off** | Yes, as a predicate. Coarse. Not a scoreboard. |
| **Play / cosmetic** | Immersion. Optional boards, titles, season skins, Nobel-style marks. | Opt-in, fun | **No.** If it moves IT, mint, or settle, it has left this layer. |
| **Role** | You keep showing up where you are depended on. Trust occupies the seat. | Visible as *who does this* | Indirect. This is closer to governance than a ladder is. |

---

## Public ladders are allowed — as play

Not against competitive fun. Against hierarchy that mints power.

A leaderboard that cannot buy IT, cannot raise rarity, cannot un-burn, cannot rewrite a DFAO knob is a skin. A leaderboard that can is a parliament with extra steps.

Default: play boards are **opt-in per DFAO**, off at PLANETARY. No global crown.

---

## Cosmetic structure (already sketched in types)

`CredentialType`: badge, title, level, achievement, certification. `visualMetadata`. `persistsAcrossSeasons`. `BADGE_EARNED`, `TITLE_AWARDED`.

3.0 should name a **mark** as a first-class object: a signed, non-transferable, non-governing award. The “Nobel as NFT” instinct — a public, scarce, *dead* token: it displays, it does not vote, it does not mint. If it is traded like a floor-price collectible, it has failed. Soulbound or it is not this.

CAT levels stay credentials (skill), not access bands, not play ranks.

Reputation titles (`Novice` … `Ecosystem Pioneer`) in `REPUTATION_LEVEL_THRESHOLDS` are play-or-credential. They must not enter the XP formula. We already burned R = reputation once.

---

## Seasons: accounting, not Diplomacy

`Season` is already in the types: window, snapshot, `rewardMultiplier`, optional rankings at close.

The old itch was a **governance game** — seasonal diplomacy. Capture the doubt: it is probably a bad idea. It recreates factions, theater, and people playing the season instead of the task.

Keep seasons as:
- accounting period
- CAT recert clock
- optional cosmetic board reset (play layer only)
- optional DFAO quest multiplier (already `rewardMultiplier`)

Do **not** wipe standing XP at `SEASON_END`.
Do **not** make season-rank = IT.
Do **not** ship a diplomacy sim as the governance path.

---

## Roles instead of (some) votes

The task-oriented version: you show up, consistently, where you are depended on. Reputation is compressed evidence of that. People stop contesting the seat because contesting it would cost more than trusting you in it.

That is **role occupancy from dependence**, not a poll.

3.0 should not silently delete conviction voting. Split:

- **Parameter changes** (settle window, decay, `b` for access bands) still vote, in the DFAO they affect. PLANETARY stays hard.
- **Who holds a working role** (steward of this MICRO, curator of this slice of DAG, the person the till already knows) defaults to *sustained presence + domain CAT + no serious burn*. Challenge is possible; it is expensive; it is not a season election.

IT still decays if you vanish (~5%). That is what empties a seat. You do not get a diplomatic reset to take it.

---

## Immersion, not a slot machine

Wanted: engaging enough that people stay in the loop. Not a dark-pattern addiction engine.

The ethical version is **the work is the game**: LocalFlow receipts, SignalFlow conversation, DAG you can see thicken, a mark you did not buy. Variable-ratio XP popups, streak guilt, fake scarcity on access bands — those are the negatives associated with hierarchy and with casinos. Ban them in 3.0 as failure modes, not as growth tactics.

Immersion test: would this still be worth doing if the cosmetic layer were off? If no, it is extracting. If yes, the skin is allowed.

---

## What 3.0 should write

1. Three-layer split: access / play / role.
2. Soulbound marks (Nobel-shaped). No floor price.
3. Opt-in DFAO boards. No PLANETARY crown.
4. Seasons = accounting + optional skins. Not diplomacy. Not XP wipe.
5. Role occupancy from showing up; votes remain for knobs.
6. Immersion test above, as a constraint, not a vibe.
7. Leave 2.1 frozen.
