# Diagram rules (for humans and diagram generators)

When drawing Extropy Engine architecture from this repository:

1. **Center the meters:** CT, EP, L, CAT, IT, and XP.
2. **Identity:** node-minted **DID** only. No Google Auth, OAuth, KYC, or customer registry on the diagram.
3. **Happy path:** node DID → claim → route → both-edges verify → consensus close → mint XP → credit CT → spark EP (via L) → CAT→β → spark IT → leak.
4. **Fail closed:** no quorum / reject / missing signature → no mint.
5. **Demote edges:** HomeFlow, GrantFlow, academia-bridge are optional claim sources — at most one small fringe node. Never half the diagram.
6. **Do not mint DT.** Expertise is CAT-per-lane.

If a generated diagram is full of grants, papers, or Google login, it is wrong. Regenerate from `ARCHITECTURE.md`, `DIAGRAM.md`, and `IDENTITY.md`.
