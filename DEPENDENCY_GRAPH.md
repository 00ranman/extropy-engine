# Extropy Engine — Dependency Graph & Data Flow

## Build Order

Services must be built in this order due to type and runtime dependencies:

```
1. @extropy/contracts        ← no dependencies, builds first
2. @extropy/epistemology-engine
3. @extropy/signal-flow
4. @extropy/loop-ledger
5. @extropy/reputation
6. @extropy/xp-mint
```

## Dependency Matrix

| Package | contracts | epistemology | signal-flow | loop-ledger | reputation |
|---------|-----------|--------------|-------------|-------------|------------|
| epistemology-engine | ✓ dep | — | — | — | — |
| signal-flow | ✓ dep | ✓ HTTP | — | — | — |
| loop-ledger | ✓ dep | ✓ HTTP | ✓ HTTP | — | — |
| reputation | ✓ dep | ✓ HTTP | ✓ event | ✓ HTTP | — |
| xp-mint | ✓ dep | ✓ event | ✓ event | ✓ HTTP | ✓ HTTP |

## Data Flow Diagrams

### Belief Propagation (Core Loop)

```
Client
  │
  ├── POST /beliefs ─────────────────────────────────────────────
  │                                                         ↓
  │                                             Epistemology Engine
  │                                               stores belief
  │                                               publishes belief.created
  │
  ├── GET /signals ──────────────────────────────────────────────
  │                                                         ↓
  │                                               Signal Flow
  │                                               (listens for belief.created)
  │                                               generates signals
  │
  └── PUT /loops/:id/close ────────────────────────────────────
                                                            ↓
                                                    Loop Ledger
                                                    validates
                                                    calls Reputation
                                                    calls XP Mint
```

### Event Bus Subscriptions

```
Publisher              Event                    Subscriber(s)
─────────────────────────────────────────────────────────────────────────
Epistemology Engine    belief.created           Signal Flow
Epistemology Engine    belief.updated           Signal Flow
Signal Flow            signal.fired             XP Mint
Loop Ledger            loop.closed              Reputation, XP Mint
Reputation             reputation.updated       (logged only)
XP Mint                xp.minted                (logged only)
```

## Inter-Service HTTP Calls

```
Loop Ledger ─── GET /users/:id ─────────────────→ Epistemology Engine
Loop Ledger ─── POST /scores/:userId ──────────── → Reputation
Loop Ledger ─── POST /mint ──────────────────── → XP Mint
Reputation ──── GET /users/:id ─────────────────→ Epistemology Engine
Reputation ──── GET /loops/:userId ───────────── → Loop Ledger
XP Mint ─────── GET /users/:id ─────────────────→ Epistemology Engine
XP Mint ─────── GET /scores/:userId ──────────── → Reputation
```

## Database Schema (Shared PostgreSQL)

Each service owns its own tables with a service-prefix naming convention:

```
epist_beliefs          ← Epistemology Engine
epist_users
signal_signals         ← Signal Flow
loop_loops             ← Loop Ledger
rep_scores             ← Reputation
xp_ledger              ← XP Mint
```

## Redis Key Patterns

```
channel: extropy:events          ← pub/sub channel for all events
cache:beliefs:{userId}           ← belief cache (TTL: 5min)
cache:reputation:{userId}        ← reputation cache (TTL: 1min)
```
