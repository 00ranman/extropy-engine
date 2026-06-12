# `@extropy/localflow`

LocalFlow is a free, local driver network coordination service — a DFAO vertical built on the Extropy Engine.

## What It Does

- Connects clients who need rides, grocery runs, or local errands with trusted nearby drivers
- Clients and drivers arrange and agree on terms directly — no platform fee, no surge pricing
- Every completed task silently emits DAG events to the Extropy Engine for empirical coordination data collection
- Users never see XP, EP, or DAG terminology — it is a matchmaking app from their perspective

## How It Fits the Extropy Engine

Each completed task is a **loop** in the Extropy Engine sense:

```
Client posts task → LOOPOPEN vertex written
Driver accepts
Driver completes task
Client confirms → LOOPCLOSE + XPMINT_PROVISIONAL vertices written (convergence point)
30 days no dispute → XPMINT_CONFIRMED
```

The convergence vertex appears in both the client's and driver's person-DAG. Minting requires multi-party convergence — solo actions cannot mint XP. This is the structural fraud resistance built into the protocol.

## XP Formula

```
XP = R × F × ΔS × (w · E) × log(1 + Ts)
EP = XP × L
```

See `src/xp.ts` for implementation. Default LocalFlow weights: economic (45%) + temporal (20%) entropy heavy.

## API

| Method | Path | Description |
|--------|------|-------------|
| POST | `/users` | Register client or driver |
| GET | `/users/:id` | Get user |
| GET | `/users/zone/:zone/drivers` | List drivers in zone |
| POST | `/tasks` | Open a task (LOOPOPEN) |
| GET | `/tasks/:id` | Get task |
| GET | `/tasks/open/:zone` | Open tasks in zone |
| PATCH | `/tasks/:id/accept` | Driver accepts |
| PATCH | `/tasks/:id/complete` | Driver marks done |
| PATCH | `/tasks/:id/confirm` | Client confirms — triggers LOOPCLOSE + XPMINT |
| GET | `/tasks/:id/dag` | DAG audit trail for task |
| GET | `/health` | Liveness |
| GET | `/mesh/vertices` | All DAG vertices (internal only) |

## Port

`4030` — consistent with extropy-engine service port conventions.

## Development

```bash
pnpm --filter @extropy/localflow dev
```

## Testing

```bash
pnpm --filter @extropy/localflow test
```

## Status

Prototype. In-memory store only. Production path:
- Replace `store.ts` with Postgres via the existing extropy-engine DB layer
- Wire `dag.ts` to publish to Redis pubsub → `dag-substrate` (port 4008)
- Add Auth middleware using the existing `identity` service (port 4101)
- Add a `docker-compose` service entry at port 4030
