# Defaults and who may change them

Publish these before the first live till. Humans will ask. “The MACRO publishes it” is an answer only if the numbers exist.

Public copy: https://extropyengine.com/docs/DEFAULTS.md

**Two clocks.** Leak ticks every **10 days** (two 5-day weeks idle). Auto H and training read **10 days** of this till’s signed cash (two 5-day weeks of books). Same number because 5 and 10 are the units. Different job. \(0.99^n\) is unchanged. \(n\) is idle 10-day counts.

## Planetary (fork to change)

| Knob | Default | Change |
|---|---|---|
| XP mint shape | R × F × ΔS × (w·E) × log(1/Tₛ) | Planetary. Fork. |
| Leak tick | 10 days | Planetary. Fork. |
| XP leak | 0.99 per 10 days (~1% of remaining) | Planetary. Fork. n = idle 10-day counts. |
| CT leak | 0.99 per idle 10 days (~1% of remaining) | Same keep as XP. Idle on web W. A close / till spark / posted task on W resets the clock. Does not travel to the next town. |
| H window | 10 days (two 5-day weeks of signed cash) | Planetary starting window for Auto and training. |
| IT | clip(H_gov · S_gov · κ · CT_W · β_gov, 0, 1) | No pile. Recomputed each proposal. Burns in the tally. |
| Cash-out of standing | Forbidden | Lose-condition. |
| Ordinary close | Target XP on the order of **0.01–1** for a MICRO loop (lawn, ride, ticket line) | Planetary starting band. Rarity can lift it. A 100-XP lawn is a mapper bug. |
| Lookers | Mint at close. Looking is a vertex. Parts of a claim, more than once, later. No validator class. One neighbor is evidence, not a gavel. | Planetary. Fork. |
| EP this sale | `min(XP · L + λ · L, line × H_cap)` | Spark cannot exceed the house cap on **this ticket**. XP is not dollars. |

Half-life of a mint ≈ 69 10-day ticks ≈ 1.9 years. ~1 year ≈ 69%. ~5 years ≈ 16%. ~8 years ≈ 5%. A decade is dust. Never zero in the reals. Late mint is the decades-later machine.

## Web W (MESO / city parent publishes)

| Knob | Default | Change |
|---|---|---|
| λ | 0.15 | Vertex. 10-day notice. One number for the web. |
| β allow-list (max) | CAT on-duty, asked domain band, signed if-then between two rooms on this language | Vertex. 10-day notice. House may only narrow. |
| H_gov | 1 | This room. 0 = one DID one nullifier. |
| S_gov | 1 if in the room, else 0 | Party to the dispute: 0. |

## This house (MICRO)

No till slider. No Off on the register. The real Off is: don’t run the node.

| Knob | Default | Change |
|---|---|---|
| H_cap | Auto | From this door’s signed cash. Not a control. |
| Training | Remainder 0 until this till has 10 days of signed tickets | Feature. Empty window does not puff discounts. |
| H_cap auto (after training) | clip(0.5 × cash_in / cash_out, 0, 1) | cash_in = drawer + overlay-touch. cash_out = inbound invoices + rent + payroll due in the window. Healthy books sit at 0.5. |
| S | 1.0 until this door has history | Auto from this door. Fake-proof / spite cut on a short clock (default 5 days, one week). |
| β this ticket | 1 if no proof asked; else the live proof | If-then. Off the clock, drop. |

## β — what counts, who attests

Counts:

1. CAT: (DID subject, lane, level, issuer). On-duty bit attested for this interval.  
2. Domain band the door asked for, as a ZKP.  
3. Signed if-then between two DFAOs on this language (fleet ↔ diner).

Does not count: a selfie, a punch card, a listed coin, “trust me I’m the manager” with no vertex.

Attest: issuer DID signs the interval. Subject DID holds the record. Issuer can revoke; spite revoke is a vertex on the issuer. Other rooms may ignore that issuer.

## Process

1. Proposed number + reason on a vertex.  
2. Delay (above). Unplug is how overlay stops. That is not a cashier button.  
3. Effective time on the vertex. Old tickets keep the old knobs.  
4. Official skins still show cash and remainder, not the knobs.

Code defaults: `packages/xp-formula` (`LEAK_DAYS`, `H_WINDOW_DAYS`, `POCKET_KEEP`, `hCapFromCash`).
