# Extropy Engine

Civilisational-scale infrastructure where verified entropy reduction is the sole basis of value.

**Core formula:** `XP = R × F × ΔS × (w · E) × log(1/Tₛ)`

## Architecture

| Service | Port | Role |
|---|---|---|
| epistemology-engine | 4001 | Claim ingestion, decomposition, Bayesian evaluation |
| signalflow | 4002 | Task routing, validator assignment |
| loop-ledger | 4003 | Loop lifecycle, measurement recording, consensus |
| reputation | 4004 | Validator registry, reputation accrual |
| xp-mint | 4005 | XP token minting, supply management |

## Quick Start

```bash
docker compose up --build -d
sleep 15
./scripts/test-happy-path.sh
```

## Build

```bash
npm install
npx lerna run build --stream
```

## Test

```bash
npx lerna run test --stream    # 12/12 passing
```

## CI

GitHub Actions runs `lerna run build` + `lerna run test` on every push.
