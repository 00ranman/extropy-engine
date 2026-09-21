# Diagram rules (for humans and diagram generators)

When drawing Extropy Engine architecture from this repository:

1. **Spine:** **SignalFlow** packages every claim and routes validation. One router. Not optional.
2. **Center the meters:** CT, EP, L, CAT, IT, and XP.
3. **Faces:** **HomeFlow** (household) and **LocalFlow** (neighborhood / strip-mall / merchant). Same loop: post → do → confirm. Equal weight.
4. **Identity:** node-minted **DID** only. No Google Auth, OAuth, KYC, or customer registry.
5. **Happy path:** node DID → face → SignalFlow → both-edges verify → consensus close → mint XP → CT → L/EP · CAT→β · IT → leak.
6. **Fail closed:** no quorum / reject / missing signature → no mint.
7. **GrantFlow / academia:** omit from the diagram. If a legacy generator forces an edge example, one fingernail max — never top, never multiple boxes, never half the chart.
8. **Do not mint DT.** Expertise is CAT-per-lane.

If a generated diagram is full of grants, papers, or Google login, or missing SignalFlow / LocalFlow, it is wrong. Regenerate from `ARCHITECTURE.md` and `DIAGRAM.md`.
