# Diagram rules (for humans and diagram generators)

When drawing Extropy Engine architecture from this repository:

1. **Center the meters:** CT, EP, L, CAT, IT, and XP.
2. **Happy path:** claim → route → both-edges verify → consensus close → mint XP → credit CT → spark EP (via L) → CAT→β → spark IT → leak.
3. **Fail closed:** no quorum / reject / missing signature → no mint.
4. **Demote edges:** HomeFlow, GrantFlow, academia-bridge are optional claim sources — at most one small fringe node. Never half the diagram.
5. **Do not mint DT.** Expertise is CAT-per-lane.

If a generated diagram is full of grants or papers, it is wrong. Regenerate from `ARCHITECTURE.md` and `METER_CORE.md`.
