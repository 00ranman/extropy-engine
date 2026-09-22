# Meter Core Architecture

**Status:** Canonical product architecture (meter-first)  
**Authority:** `docs/SPEC_v3.5.md` → `packages/xp-formula` → this doc  
**Faces:** LocalFlow (person), HomeFlow (house), quest market, merchant till sit on **SignalFlow**. Meters are the center.

## Center of gravity

The Extropy Engine is a **closed-loop meter protocol**. Diagrams, workflows, READMEs, and package boundaries must lead with these objects:

| Object | Kind | Job |
|--------|------|-----|
| **XP** | Meter | Standing from verified ΔS. Non-transferable. Leaks `0.99ⁿ`. No cash-out. |
| **CT_W** | Meter | Community standing on web W. Same readout at compatible tills. Feeds L and IT. |
| **L** | This-ticket math | `L = clip(H_cap · S · κ · CT_W · β, 0, 1)`. Not a sixth bag. |
| **EP** | Till spark | `EP = XP · L + λ · L`. Born and burned in the sale. Not a wallet pile. |
| **CAT** | Record | Skill credential `(DID, lane, level, issuer)`. Off the mint. Feeds β. |
| **IT** | This proposal | `IT = clip(H_gov · S_gov · κ · CT_W · β_gov, 0, 1)`. Burns in the tally. No pile. |

**DT is not a bag.** Do not mint DT. Expertise is CAT-per-lane.

## Canonical mint (XP only)

```
XP = R × F × ΔS × (w · E) × log(1/Ts)
```

- **R** = rarity of the **action class** ∈ [0.1, 10]. Not reputation. Not CT.
- CT / ρ_W never enter the mint product.
- **OPEN:** who publishes the R table (governance defaults vs schedule). Code consumes R as input.

Code: `packages/xp-formula` — `computeXP`, `computeL`, `computeEP`, `computeIT`, `sparkTill`, `sparkVote`, `leakCT`, `hCapFromCash`.

## Closed loop (happy path)

```
face → SignalFlow packages claim → both-edges verify → consensus close
  → mint XP → credit CT → spark EP (via L) → CAT→β → spark IT (gov) → temporal leak
```

Fails closed: no quorum / reject / missing counterparty signature → **no XP mint**, no CT credit, no EP.

## Faces on SignalFlow (not the center)

| Face | Role |
|------|------|
| LocalFlow | Person / errands. Rides, groceries, the car you don’t have. |
| HomeFlow | House / neighborhood. Chores, rooms. Neighborhood-app is the MESO board. |
| Quest market | 2–5 minute grain. |
| Merchant till | Strip mall. Cash still rings. EP dies in the sale. `sparkTill` + `two-till-demo`. |

**SignalFlow** packages every claim and routes validation. Same loop on every face: post → do → confirm.

HomeFlow identity is node DID — not Google OAuth.

## Package map (meter-first)

| Concern | Package |
|---------|---------|
| Math | `@extropy/xp-formula` |
| Facade + types for diagrams/workflows | `@extropy/meters` |
| Mint XP on `loop.closed` | `xp-mint` |
| CAT records | `credentials` (+ meters CAT types) |
| CT credit / leak path | reputation + meters helpers |
| IT / votes | governance (+ `sparkVote`) |
| Legacy wallet framing | `token-economy` — **debt**: align to meters; stop pileable EP/IT |

## Product rule

Shareable architecture notes are **PRODUCT ONLY**. Mechanisms over slogans. Mark speculation. No cash-out path (I1 Non-Extraction).
