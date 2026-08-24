# Codex 3.0 — access bands (under the floor)

**Status:** Codex v2.1 stays frozen. Companion to `docs/CODEX_3_NOTES.md`.
**Date:** 2026-08-23

XP decays (~1%/month, ρ = 0.01 / 30 cycles). The math does not care if the pile is called XP or “level.” People do. So do merchants and DFAO gates. This note is how to translate without building a game hierarchy.

---

## Already in the types — do not confuse these

These exist in `packages/contracts/src/types.ts`. They are **not** this proposal:

- `Season` / `SEASON_START` / `SEASON_END` — accounting period, snapshots, `seasonDurationDays` (knob).
- `SeasonRanking`, `LeaderboardEntry`, titles (`Novice` … `Ecosystem Pioneer`), `LEVEL_UP`, badges.
- `CATCertification.level` on a log scale (10 / 30 / 90 / 270 …). Identity-bearing skill, not XP.
- `Credential.persistsAcrossSeasons`.

Those can stay as **credentials** (CAT, titles you opted into). They must not become the access economy. A public ladder is how you get farming. 3.0 should say that out loud.

---

## The proposal: a band, not a level-up

Under the floor, decayed standing XP quantizes into an **access band** `L` — a coarse bucket the math can branch on.

- Input: standing XP after decay (and after any late burn).
- Output: `L ∈ {0,1,2,…}` on a **log** scale so the 1% drip doesn’t bounce you across a cliff every week.
- Nobody sees `L` as a skin. LocalFlow still looks like a receipt. The merchant till still looks like a tab.
- The protocol sees `L` as a predicate: *this gate wants band ≥ 3*.

Math does not care. Gates do. Bands exist so a till, a DFAO, or SignalFlow can ask a yes/no without reading the diary.

---

## ZKP, not a published hierarchy

The user proves `decayedXP ≥ threshold(L)` (or `∈ [L, L+1)`) without revealing the stack.

Same autarky rule as everything else: edge holds the number; the mesh gets a proof. Company login still tethers. Own hardware still doesn’t.

If you print titles next to it, you have rebuilt the leaderboard. Don’t.

---

## Seasonal start-overs: probably not for XP

Decay already eats idle piles. A seasonal **wipe** of standing XP would punish slow real work (forests, kids, papers) harder than 1% does, and it would manufacture a game season for engagement. That fights the access-economy claim.

Keep seasons as they are specified: **accounting windows**. Snapshot, CAT recert clock, maybe a seasonal *band floor* for a local DFAO if they vote it. Do not zero the pile at `SEASON_END` unless PLANETARY later writes that as an axiom (it is not one now).

If a DFAO wants a seasonal quest multiplier, that is already `Season.rewardMultiplier`. That is not a start-over.

---

## Why this is harder to game than a public XP number

- Underground: no feed, no rank, no “I’m level 9.”
- Coarse: you cannot micro-snipe a threshold every mint; log bands are sticky.
- Decay is in the input: sitting still drops you through bands without a ceremony.
- Proof is threshold, not magnitude: overselling a single lawn cannot flash a crown if the band is log and the pile still has to exist after 1%.

It can still be gamed if you *display* it. Display is the failure mode. Treat display as a DFAO skin choice, default off.

---

## What 3.0 should decide

1. Access band `L = floor(log_b(1 + decayedXP))` or equivalent. `b` is a knob.
2. ZKP predicate for gates. Default public display: off.
3. No seasonal XP wipe. Seasons stay snapshots / recert / optional multiplier.
4. Keep CAT levels and optional titles in credentials, off the access path.
5. Do not let reputation titles (`REPUTATION_LEVEL_THRESHOLDS`) leak into XP-band math. Reputation is not XP. We already burned that once.
6. Leave 2.1 frozen.
