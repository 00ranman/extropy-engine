# Extropy Engine — Dependency Graph & Data Flow

## Build Order

Services must be built in this order due to type and runtime dependencies:

```
1. @extropy/contracts        ← no dependencies, builds first
2. @extropy/event-bus        ← depends on @extropy/contracts
3. epistemology-engine       ← depends on contracts + event-bus
4. signalflow                ← depends on contracts + event-bus
5. loop-ledger               ← depends on contracts + event-bus
6. reputation                ← depends on contracts + event-bus
7. xp-mint                   ← depends on contracts + event-bus + loop-ledger (for loop reads)
```

## Package Dependency Matrix

```
                    contracts  event-bus  epistemology  signalflow  loop-ledger  reputation  xp-mint
contracts              —
event-bus              ✓          —
epistemology-engine    ✓          ✓            —
signalflow             ✓          ✓                         —
loop-ledger            ✓          ✓                                      —
reputation             ✓          ✓                                                   —
xp-mint                ✓          ✓                                      reads                  —
```

## Event Flow

```
POST /claims
  │
  ▼
epistomology-engine
  │  publishes: claim.submitted
  │             loop.opened          ─────────────────────────────►  loop-ledger
  │             claim.decomposed
  │
  ▼ (subscribes: claim.submitted)
signalflow
  │  creates Tasks for each sub-claim
  │  publishes: task.created
  │             task.assigned
  │
  ▼ (validator calls POST /tasks/:id/complete)
signalflow
  │  publishes: task.completed
  │
  ├──────────────────────────────────────────────────────────────►  epistemology-engine
  │                                                                    subscribes: task.completed
  │                                                                    updates sub-claim status
  │                                                                    runs Bayesian update
  │                                                                    publishes: subclaim.updated
  │                                                                              claim.evaluated
  │
  └──────────────────────────────────────────────────────────────►  loop-ledger
                                                                       subscribes: task.completed
                                                                                   subclaim.updated
                                                                                   claim.evaluated
                                                                       records measurements
                                                                       runs consensus
                                                                       publishes: loop.consensus
                                                                                 loop.closed
                                                                                 loop.settled
                                                                            │
                                                                            ├──► xp-mint
                                                                            │      subscribes: loop.closed
                                                                            │      computes XP = R×F×ΔS×(w·E)×log(1/Tₛ)
                                                                            │      publishes: xp.minted
                                                                            │
                                                                            └──► reputation
                                                                                   subscribes: xp.minted
                                                                                               loop.settled
                                                                                   accrues reputation
```

## Data Stores

All services share one PostgreSQL database (`extropy_engine`) with isolated schemas:

| Service | Schema | Key Tables |
|---|---|---|
| epistemology-engine | `epistemology` | `claims`, `sub_claims` |
| signalflow | `signalflow` | `tasks` |
| loop-ledger | `loop_ledger` | `loops`, `measurements`, `consensus_votes` |
| reputation | `reputation` | `validators`, `reputation_events` |
| xp-mint | `xp_mint` | `mint_events`, `xp_distributions` |
| shared | `public` | `event_log` |

Redis is used exclusively as the event bus (pub/sub channels).

## Port Map

| Service | Port | Health Endpoint |
|---|---|---|
| epistemology-engine | 4001 | GET /health |
| signalflow | 4002 | GET /health |
| loop-ledger | 4003 | GET /health |
| reputation | 4004 | GET /health |
| xp-mint | 4005 | GET /health |
| PostgreSQL | 5432 | — |
| Redis | 6379 | — |
