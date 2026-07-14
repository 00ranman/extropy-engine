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
Client posts task    -> LOOPOPEN vertex written; raw baseline captured
Driver accepts
Driver completes task
Client confirms       -> LOOPCLOSE + MEASUREMENT vertices written (convergence point)
                         MEASUREMENT stores raw baseline + outcome and a
                         normalization status (unavailable | pending | normalized)
If a validated normalized measurement is supplied
                      -> XPMINT_PROVISIONAL vertex written
30 days no dispute    -> XPMINT_CONFIRMED (not yet implemented)
```

The convergence vertex appears in both the client's and driver's person-DAG. Minting requires multi-party convergence, so solo actions cannot mint XP. This is the structural fraud resistance built into the protocol.

## Measurement integrity

LocalFlow captures **raw observables** only:

- At open: the client's expected duration or wait (raw baseline).
- At close: actual elapsed duration, completion status, timestamps, and
  independent confirmation metadata (raw outcome).

LocalFlow does **not** derive a normalized entropy delta (deltaS_be) from these
observables. Elapsed time is never treated as deltaS or as a normalized
settlement-time factor. The canonical M_d normalization is out of scope for this
package.

XP settlement is gated: `XPMINT_PROVISIONAL` is emitted only when the confirm
request carries an explicitly supplied, validated normalized measurement
(canonical `XPFormulaInputs`). Without one, the loop closes and the MEASUREMENT
vertex is recorded with status `unavailable`, but no XP is minted.

## XP Formula

XP is computed by the canonical `@extropy/xp-formula` package (single source of
truth). LocalFlow does not reimplement the formula; `src/xp.ts` delegates to it
and applies only the local EP = XP x L merchant loyalty multiplier. XP is
non-transferable and non-extractive.

## Simulation adapter (demo only)

`src/simulation.ts` can fabricate a normalized measurement from raw observables
so the demo can exercise the full mint path without a real validator. Its output
is always flagged `simulated: true` and it is never a production measurement.
Opt in per request with `{ "simulate": true }` on confirm.

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
| PATCH | `/tasks/:id/confirm` | Client confirms; triggers LOOPCLOSE + MEASUREMENT. Optional body `normalizedMeasurement` (validated) or `simulate: true` (demo) gates XPMINT |
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

Prototype. This slice is **measurement plumbing, not a validated M_d**. It
proves that raw baseline and outcome evidence flow through LocalFlow and that XP
settlement is gated on an explicitly validated normalized measurement. It does
not establish that the normalization itself is correct.

Still open (out of scope for this slice):
- The canonical M_d normalization, coefficients, thresholds, and evidence
  weights. LocalFlow only carries a supplied normalization; it does not compute
  one. The simulation adapter is a demo stand-in, not a validated normalization.
- Production persistence: replace `store.ts` (in-memory) with Postgres via the
  existing extropy-engine DB layer.
- Real DAG integration: wire `dag.ts` to publish to Redis pubsub so
  `dag-substrate` (port 4008) consumes the vertices. Today they are in-memory.
- Identity and auth via the existing `identity` service (port 4101).
- Independent validators: LocalFlow records independent confirmation presence
  but does not fabricate or verify it.
- Disputes: the `disputed` status exists but no dispute workflow is implemented.
- A `docker-compose` service entry at port 4030.
