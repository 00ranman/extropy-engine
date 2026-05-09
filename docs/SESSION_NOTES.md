# Session Notes

## 2026-05-06 — Backend Services Build + Happy Path + HomeFlow Pilot

### What was built

**5 core backend services** (TypeScript, Express, PostgreSQL, Redis) under `packages/`:

| Package | Port | Role |
|---|---|---|
| `epistemology-engine` | 4001 | Mesh observability, Bayesian sub-claim scoring, claim lifecycle |
| `signalflow` | 4002 | Validator routing (domain × reputation × load × accuracy) |
| `loop-ledger` | 4003 | Loop lifecycle, DAG, entropy measurements, consensus |
| `reputation` | 4004 | Per-domain reputation accrual, decay, streak bonuses |
| `xp-mint` | 4005 | XP minting with physics floor, two-phase provisional/confirmed |

**Shared contracts** (`packages/contracts/src/`):
- `types.ts` — 9 core domain entities, 22 typed inter-service events, branded ID types
- `event-bus.ts` — Redis pub/sub, typed emit/subscribe, event log persistence
- `db.ts` — PostgreSQL + Redis connection factories, startup retry helpers

**Infrastructure:**
- `scripts/init-db.sql` — full schema: 5 per-service PostgreSQL schemas, DAG edge table, event_log, all indexes
- `scripts/run-integration-test.py` — Python subprocess orchestrator for non-Docker local runs
- `scripts/test-happy-path.sh` — shell harness for docker-compose
- `docker-compose.yml` — PostgreSQL 16, Redis 7, all 5 services, health checks

**HomeFlow pilot** (`packages/homeflow/`):
- Setup wizard, household + member management, chores, recipes + meal plan, pantry, shopping list, XP dashboard
- Google OAuth live, deploy script at repo root

### Bug found and fixed

**Epistemology Engine verdict mapping** (`packages/epistemology-engine/src/index.ts`):

The `applyEvidence` function and event bus handler for `task.completed` both mapped verdict to `'confirmed' | 'denied'` using strict equality: `verdict === 'confirmed'`. Validators and test scripts emit `'supported'` as the affirmative verdict. This meant every task completion was treated as falsifying evidence, driving Bayesian posteriors from 0.5 down to ~0.08 regardless of consensus. All loops evaluated as `falsified`. Fix: accept both `'confirmed'` and `'supported'` as affirmative.

**Root cause pattern to watch:** The contracts define the `ValidationVerdict` type but service code re-implemented the mapping inline without importing the type. Adding a contract-level `isAffirmativeVerdict(v: string): boolean` helper and importing it in all services would prevent this class of bug.

### API contracts verified during integration testing

These are the **actual field names** expected by each service, confirmed against live responses:

```
POST /validators           { name, type, domains }              → reputation service
POST /claims               { statement, domain, submitterId }   → epistemology-engine
GET  /subclaims/by-claim/:claimId                              → epistemology-engine
GET  /loops/by-claim/:claimId                                  → loop-ledger
POST /tasks/:id/complete   { verdict, confidence, evidence }   → signalflow
GET  /mint/by-loop/:loopId                                     → xp-mint
GET  /reputation/:validatorId                                  → reputation
```

Valid `EntropyDomain` values (PostgreSQL enum): `cognitive | code | social | economic | thermodynamic | informational`

Note: `'physics'` is NOT a valid domain. Use `'thermodynamic'`.

### Integration test results

12/12 tests passing. Full event cascade verified:

```
POST /claims
  → claim.submitted
  → loop.opened (Loop Ledger)
  → claim.decomposed (3 sub-claims)
  → task.created × 3 (SignalFlow)
  → task.assigned × 3
  [test completes tasks: verdict='supported', confidence=0.92]
  → task.completed × 3
  → subclaim.updated × 3 (posterior: 0.92 → status: verified)
  → claim.evaluated (truth_score=0.92, status=verified)
  → loop.consensus_started
  → loop.closed (ΔS=40, Tₛ=8.1s)
  → xp.minted.provisional (~4,000,000,000 XP)
  → reputation.accrued (streak bonus applied)
  → loop.settled
```

### Open items from this session

1. **Verdict vocabulary** (Gap #25): define canonical `ValidationVerdict` enum in contracts, enforce at boundaries.
2. **Contract test suite**: no test currently validates that service APIs match the OpenAPI specs in `architecture/`. This is the most likely source of future API drift.
3. **HomeFlow Redis dependency**: the family pilot used a Redis-optional flag workaround. The Redis-optional fix was deferred. Revisit before adding more HomeFlow features.
4. **v3.1 branch merge**: `v3.1-canonical-update` branch pushed but PR not opened. Merge decision pending.
5. **VPS handshake test**: node-handshake package built, local smoke test infrastructure ready. Actual VPS↔laptop test not yet run.
