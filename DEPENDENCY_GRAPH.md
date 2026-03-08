# Extropy Engine — Dependency Graph & Data Flow

## Build Order

Services must be built in this order due to type and runtime dependencies:

```
1.  @extropy/contracts          <- no dependencies, builds first
2.  @extropy/event-bus           <- depends on @extropy/contracts
3.  epistemology-engine          <- depends on contracts + event-bus
4.  signalflow                   <- depends on contracts + event-bus
5.  loop-ledger                  <- depends on contracts + event-bus
6.  reputation                   <- depends on contracts + event-bus
7.  xp-mint                      <- depends on contracts + event-bus + loop-ledger (for loop reads)
8.  dag-substrate                <- depends on contracts + event-bus (records all system events)
9.  dfao-registry                <- depends on contracts + event-bus + dag-substrate
10. governance                   <- depends on contracts + event-bus + dfao-registry
11. temporal                     <- depends on contracts + event-bus (seasons, loop timers, decay)
12. token-economy                <- depends on contracts + event-bus + xp-mint
13. credentials                  <- depends on contracts + event-bus + reputation
14. ecosystem                    <- depends on contracts + event-bus (aggregates all services)
15. homeflow                     <- depends on contracts + event-bus + all core services
16. grantflow-discovery          <- depends on contracts + event-bus
17. grantflow-proposer           <- depends on contracts + event-bus + grantflow-discovery
```

## Port Map

| Service              | Port | Health Endpoint |
|----------------------|------|-----------------|
| epistemology-engine  | 4001 | GET /health     |
| signalflow           | 4002 | GET /health     |
| loop-ledger          | 4003 | GET /health     |
| reputation           | 4004 | GET /health     |
| xp-mint              | 4005 | GET /health     |
| dag-substrate        | 4008 | GET /health     |
| dfao-registry        | 4009 | GET /health     |
| governance           | 4010 | GET /health     |
| temporal             | 4011 | GET /health     |
| token-economy        | 4012 | GET /health     |
| credentials          | 4013 | GET /health     |
| ecosystem            | 4014 | GET /health     |
| homeflow             | 4015 | GET /health     |
| grantflow-discovery  | 4020 | GET /health     |
| grantflow-proposer   | 4021 | GET /health     |
| PostgreSQL           | 5432 | —               |
| Redis                | 6379 | —               |

## Frontends

| Frontend          | Dev Port | Description                        |
|-------------------|----------|------------------------------------||
| character-sheet   | 3000     | Character/validator profile UI     |
| grantflow-ui      | 3001     | Grant discovery & proposal UI      |
| homeflow-ui       | 3002     | Household management dashboard     |

## Data Stores

All services share one PostgreSQL database (`extropy_engine`) with isolated schemas:

| Service             | Schema          | Key Tables                                    |
|---------------------|-----------------|-----------------------------------------------|
| epistemology-engine | `epistemology`  | `claims`, `sub_claims`                        |
| signalflow          | `signalflow`    | `tasks`                                       |
| loop-ledger         | `loop_ledger`   | `loops`, `measurements`, `consensus_votes`    |
| reputation          | `reputation`    | `validators`, `reputation_events`             |
| xp-mint             | `xp_mint`       | `mint_events`, `xp_distributions`             |
| dag-substrate       | `dag`           | `vertices`, `edges`, `confirmations`          |
| dfao-registry       | `dfao`          | `dfaos`, `members`, `governance_weights`      |
| governance          | `governance`    | `proposals`, `votes`, `resolutions`           |
| temporal            | `temporal`      | `seasons`, `timers`, `decay_events`           |
| token-economy       | `economy`       | `credit_types`, `transactions`, `balances`    |
| credentials         | `credentials`   | `badges`, `certifications`, `achievements`    |
| ecosystem           | `ecosystem`     | `service_registry`, `aggregations`            |
| homeflow            | `homeflow`      | `hf_households`, `hf_devices`, `hf_entropy_events`, `hf_inventory`, `hf_tasks`, `hf_meal_plans`, `hf_health_profiles`, `hf_shopping_lists` |
| grantflow-discovery | `grantflow`     | `gf_profiles`, `gf_opportunities`, `gf_matches` |
| grantflow-proposer  | `grantflow`     | `gf_proposals`, `gf_submissions`              |
| shared              | `public`        | `event_log`                                   |

Redis is used exclusively as the event bus (pub/sub channels).

## Event Flow

```
POST /claims
     |
     v
epistemology-engine
     |  publishes: claim.submitted
     |             loop.opened ----------------------> loop-ledger
     |             claim.decomposed
     v                                    (subscribes: claim.submitted)
signalflow
     |  creates Tasks for each sub-claim
     |  publishes: task.created
     |             task.assigned
     v
(validator calls POST /tasks/:id/complete)
signalflow
     |  publishes: task.completed
     |
     +-----> epistemology-engine
     |         subscribes: task.completed
     |         updates sub-claim status
     |         runs Bayesian update
     |         publishes: subclaim.updated
     |                    claim.evaluated
     |
     +-----> loop-ledger
               subscribes: task.completed
                          subclaim.updated
                          claim.evaluated
               records measurements
               runs consensus
               publishes: loop.consensus
                         loop.closed
                         loop.settled
               |
               +---> xp-mint
               |       subscribes: loop.closed
               |       computes XP = R*F*dS*(w*E)*log(1/Ts)
               |       publishes: xp.minted
               |
               +---> reputation
               |       subscribes: xp.minted
               |                  loop.settled
               |       accrues reputation
               |
               +---> dag-substrate
               |       subscribes: ALL events
               |       records vertices in DAG
               |
               +---> token-economy
                       subscribes: xp.minted
                       manages CT/CAT/IT/DT tokens

homeflow events:
  inventory.change --> epistemology-engine (entropy claims)
  chore.completed  --> xp-mint (household XP)
  entropy.measured --> loop-ledger (verification loops)

grantflow events:
  grant.discovered --> grantflow-proposer (match notification)
  proposal.submitted --> ecosystem (aggregation)
```
