# token-economy → meter alignment

`packages/xp-formula` and `@extropy/meters` are authoritative for CT / EP / L / CAT / IT.

This service still carries wallet/balance framing (legacy). Until refactored:

1. Import `computeL`, `computeEP`, `computeIT`, `sparkTill`, `sparkVote`, `leakCT` from `@extropy/xp-formula` (or `@extropy/meters`).
2. Do **not** treat EP or IT as pileable balances.
3. L is `clip(H_cap · S · κ · CT_W · β, 0, 1)` — not `clip(H · CT · β)`.
4. Do not mint DT.
5. Prefer `@extropy/meters` types (`CTMeter`, `CATRecord`, `EPSpark`, `ITSpark`) in new code paths.

Tracked as meter-first debt from PR `feat/meter-first-ct-ep-l-cat-it`.
