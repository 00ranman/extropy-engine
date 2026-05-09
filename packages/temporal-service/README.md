# @extropy/temporal-service

Universal Times temporal service. Computes Eon, Age, Era, Epoch, Cycle,
Season, Current, Spin, Tide, Wave, GQ duration units and the Solar
Loop, Arc, Tick subdivisions for any UTC instant. Fires HTTP callbacks
to subscribers when a unit transition occurs.

The canonical specification is `docs/universaltimes-reference.html`,
served live at https://extropyengine.com/universaltimes.html. Every
constant and arithmetic step in `src/universaltimes.ts` is a verbatim
port of the JavaScript on that page. Co-written and curated by Randall
Gossett.

## Install and run

```bash
pnpm install
pnpm --filter @extropy/temporal-service run build
TEMPORAL_PORT=4002 TEMPORAL_DATA_DIR=/var/lib/temporal pnpm --filter @extropy/temporal-service start
```

## Environment

| Variable | Default | Purpose |
| --- | --- | --- |
| `TEMPORAL_PORT` | `4002` | Listen port |
| `TEMPORAL_DATA_DIR` | `/var/lib/temporal` if writable, else `./.data` | File-backed store directory |
| `HOMEFLOW_DATA_DIR` | unset | Fallback if `TEMPORAL_DATA_DIR` is unset |
| `TEMPORAL_ADMIN_TOKEN` | unset | If set, gates the `/transition/:unit/test` endpoint |
| `TEMPORAL_VERSION` | `0.1.0` | Reported in `/health` |

## API

### `GET /health`

```json
{
  "status": "healthy",
  "service": "temporal",
  "version": "0.1.0",
  "uptime": 12.3,
  "subscribers": 0,
  "retryQueue": 0
}
```

### `GET /now[?at=ISO]`

Returns the full Universal Times reading. Without `at` the snapshot is
for the current instant.

```json
{
  "unix": 1778457600,
  "iso": "2026-05-06T00:00:00.000Z",
  "utUnits": {
    "eon": 1, "age": 23, "era": 45, "epoch": 7,
    "cycle": 12, "season": 33, "current": 9, "spin": 4,
    "tide": 0, "wave": 33, "gq": 81, "orbit": 12
  },
  "solarUnits": { "loop": 0, "arc": 0, "tick": 0 },
  "calendar": { "year": 2026, "month": 4, "day": 6, "dayOfYear": 126, "daysInYear": 365, "leap": false },
  "fractions": { "dayFrac": 0, "loopFrac": 0, "arcFrac": 0, "tickFrac": 0, "waveFrac": 0.43, "tideFrac": 0.18, "currentFrac": 0.18, "seasonFrac": 0.55, "epochFrac": 0.07 },
  "bbQuants": "6.180000e+26 quants",
  "ceEpoch": 282
}
```

### `POST /subscribe`

```json
{
  "subscriberId": "homeflow",
  "callbackUrl": "https://homeflow.extropyengine.com/temporal/event",
  "unit": "Season",
  "hmacSecret": "shared-with-callback"
}
```

`unit` may be any of: `GQ Wave Tide Spin Current Season Orbit Cycle Epoch
Era Age Eon Loop Arc Tick`.

Response:

```json
{ "subscriptionId": "f39c91c2-..." }
```

A duplicate registration with the same `(subscriberId, unit, callbackUrl)`
returns the existing id with `"deduplicated": true`.

### `DELETE /subscribe/:id`

Removes the subscription. Returns 204 on success, 404 if not found.

### `GET /subscribers`

Debug listing.

### `POST /transition/:unit/test`

Admin endpoint that immediately fires a callback for every subscriber
attached to the named unit. Useful for end to end testing. Gated by
`X-Admin-Token` header when `TEMPORAL_ADMIN_TOKEN` is set.

## Callback payload

Posted to the subscriber's `callbackUrl` whenever the unit's integer
counter advances:

```json
{
  "subscriberId": "homeflow",
  "subscriptionId": "f39c91c2-...",
  "unit": "Season",
  "oldValue": 100,
  "newValue": 101,
  "timestamp": "2026-05-06T00:00:00.000Z",
  "utUnits": { "eon": 1, "age": 23, "era": 45, "epoch": 7, "cycle": 12, "season": 101, "current": 9, "spin": 4, "tide": 0, "wave": 33, "gq": 81, "orbit": 12 },
  "solarUnits": { "loop": 0, "arc": 0, "tick": 0 },
  "calendar": { "year": 2026, "month": 4, "day": 6, "dayOfYear": 126, "daysInYear": 365, "leap": false }
}
```

When the subscriber registered with `hmacSecret`, the request carries an
`X-Temporal-Signature: sha256=<hex>` header computed as
`HMAC-SHA256(secret, body)`.

Failure handling: HTTP non 2xx responses or thrown errors enqueue the
delivery for retry with exponential backoff at `1s, 5s, 30s, 2m, 10m`.
After five attempts the delivery is logged and dropped.

## Constants

| Symbol | Value | Source |
| --- | --- | --- |
| `HF` | `1420405751.768` Hz | Hydrogen hyperfine frequency |
| `BB_SEC` | `4.350639312e17` s | Big Bang anchor |
| `YEAR0_UNIX` | `-62167219200` | Year 0 in Unix seconds |
| `TROPICAL_SEC` | `31556925.216` s | Tropical year |
| `durExp` | `[9, 11, 13, 14, 15, 16, 17, 18, 20, 22, 24]` | GQ to Eon |
| `CAL` | `dpm=40, m10n=5, m10l=6, cyc=5` | Calendar |

`durSec[i] = 10^durExp[i] / HF` so each duration unit has a known
period. Solar Tick is `0.864` s, Arc is `86.4` s, Loop is `8640` s, Day
is `86400` s.

Leap rule: `(y%4===0 && y%100!==0) || y%400===0`.

## Tests

```bash
pnpm --filter @extropy/temporal-service test
```

Golden value tests in `src/__tests__/universaltimes.test.ts` reproduce
the reference page math at three sample instants and assert every dial
matches.
