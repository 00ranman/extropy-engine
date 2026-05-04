# @extropy/quest-market

Micro-quest marketplace with dynamic reward escalation. The default operational primitive of Extropy v3.1.

**Status:** Skeleton. See [`docs/QUEST_MARKET.md`](../../docs/QUEST_MARKET.md) for spec.

## Responsibilities

- Quest publication (claims decomposed by personal AI into 2–5 min tasks)
- Reward escalation (linear→3× over 7d, log to cap 10×)
- Acceptance and completion lifecycle
- Coordination with `signalflow` for routing and `validation-neighborhoods` for slice routing
- Marketplace queryable views (near me, in skill profile, escalated, validation tasks)
- Anti-abuse hooks (decomposition limits, rate-limiting, reputation gates)

## Non-responsibilities

- Does NOT decompose claims (personal AI does)
- Does NOT validate (validation-neighborhoods does)
- Does NOT mint XP (xp-mint does)

## API surface (target)

| Endpoint | Purpose |
|---|---|
| `POST /quests` | Publish quest |
| `GET /quests` | Query marketplace (filters: location, skill, escalation, validation) |
| `POST /quests/:id/accept` | Accept quest |
| `POST /quests/:id/complete` | Submit completion + evidence |
| `POST /quests/:id/escalate-now` | Manual escalation trigger (governance-gated) |
| `GET /quests/:id` | Quest detail |
