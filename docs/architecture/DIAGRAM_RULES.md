# Diagram rules (for humans and diagram generators)

When drawing Extropy Engine architecture from this repository:

1. **Spine:** **SignalFlow** packages every claim and routes validation. One router.
2. **Center the meters:** CT, EP, L, CAT, IT, and XP.
3. **Faces (only these):** **LocalFlow** (person / errands), **HomeFlow** (house / neighborhood), **quest market**, **merchant till** (strip mall / EP). Same loop: post → do → confirm. LocalFlow is not the till.
4. **Identity:** node-minted **DID** only.
5. **Happy path:** node DID → face → SignalFlow → both-edges verify → close → mint XP → CT → L/EP · CAT→β · IT → leak.
6. **Fail closed:** no quorum / reject / missing signature → no mint.
7. **Do not inventory `packages/`.** A folder is not a face. Draw only the four faces above.
8. **Do not mint DT.** Expertise is CAT-per-lane.

If a generated diagram is missing SignalFlow, LocalFlow, HomeFlow, or the till, it is wrong. Regenerate from `docs/ARCHITECTURE.md`.
