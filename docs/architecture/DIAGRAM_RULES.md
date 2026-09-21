# Diagram rules (for humans and diagram generators)

When drawing Extropy Engine architecture from this repository:

1. **Spine:** **SignalFlow** packages every claim and routes validation. One router. Not optional.
2. **Center the meters:** CT, EP, L, CAT, IT, and XP.
3. **Faces:** **LocalFlow** (person / errands), **HomeFlow** (house / neighborhood), **quest market**, **merchant till** (strip mall / EP). Same loop: post → do → confirm. Equal weight. LocalFlow is not the till.
4. **Identity:** node-minted **DID** only. No Google Auth, OAuth, KYC, or customer registry.
5. **Happy path:** node DID → face → SignalFlow → both-edges verify → close → mint XP → CT → L/EP · CAT→β · IT → leak.
6. **Fail closed:** no quorum / reject / missing signature → no mint.
7. **grantflow / academia:** one optional door on the same pipeline, or omit. Never top. Never multiple boxes. Never half the chart. Not a product.
8. **Do not mint DT.** Expertise is CAT-per-lane.

If a generated diagram is full of grants, papers, or Google login, or missing SignalFlow / LocalFlow / the till, it is wrong. Regenerate from `docs/ARCHITECTURE.md`.
