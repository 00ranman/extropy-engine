# Defaults and who may change them

Publish these before the first live till. Humans will ask. “The MACRO publishes it” is an answer only if the numbers exist.

Public copy: https://extropyengine.com/docs/DEFAULTS.md

## Planetary (fork to change)

| Knob | Default | Change |
|---|---|---|
| XP mint shape | R × F × ΔS × (w·E) × log(1/Tₛ) | Planetary. Fork. |
| XP leak | 0.99 per ~30 days (~1% of remaining) | Planetary. Fork. |
| CT leak | 0.97 per ~30 days (~3% of remaining) | Web W. 30 days notice. Replaces transfer-burn. |
| IT leak | 0.95 per ~30 days (~5% of remaining, idle) | Planetary default. A room may not slow it below 0.96 without a fork. |
| Cash-out of standing | Forbidden | Lose-condition. |

## Web W (MESO / city parent publishes)

| Knob | Default | Change |
|---|---|---|
| λ | 0.15 | Vertex. 30 days notice. One number for the web. |
| β allow-list (max) | CAT on-duty, asked domain band, signed if-then between two rooms on this language | Vertex. 14 days notice. House may only narrow. |
| Fat U_W | Requires a stranger close | Web rule. |

## This house (MICRO)

| Knob | Default | Change |
|---|---|---|
| H_cap | 0.5 | Auto from trailing 4-week cash. Manual override is a vertex. Park to 0 is immediate. |
| S | 1.0 until this door has history | Auto from this door. Fake-proof / spite cut on a short clock (default 14 days). |
| β this ticket | 1 if no proof asked; else the live proof | If-then. Off the clock, drop. |
| H_cap auto | clip(0.5 × cash_in_4w / cash_out_4w, 0, 1) | cash_in = drawer + overlay-touch. cash_out = inbound invoices + rent + payroll due in the window. |

## β — what counts, who attests

Counts:

1. CAT: (DID subject, lane, level, issuer). On-duty bit attested for this interval.  
2. Domain band the door asked for, as a ZKP.  
3. Signed if-then between two DFAOs on this language (fleet ↔ diner).

Does not count: a selfie, a punch card, a listed coin, “trust me I’m the manager” with no vertex.

Attest: issuer DID signs the interval. Subject DID holds the record. Issuer can revoke; spite revoke is a vertex on the issuer. Other rooms may ignore that issuer.

## Process

1. Proposed number + reason on a vertex.  
2. Delay (above) except park H_cap = 0.  
3. Effective time on the vertex. Old tickets keep the old knobs.  
4. Official skins still show cash and remainder, not the knobs.

Code defaults: `packages/xp-formula` (`DEFAULT_EP_FLOOR`, `DEFAULT_H_CAP`, `hCapFromCash`).
