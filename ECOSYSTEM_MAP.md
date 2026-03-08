# Extropy Ecosystem — Repository Map

This document maps every repository in the 00ranman GitHub organization to its
role in the Extropy Engine monorepo. Standalone repos are the original Python/Rust
implementations; the deployed TypeScript packages live under `packages/`.

**Project Board:** [Extropy Ecosystem Tracker](https://github.com/users/00ranman/projects/1) — Kanban board tracking all integration, infrastructure, and feature work across the ecosystem.

## Standalone → Monorepo Mapping

| Standalone Repo | Lang | Port | Monorepo Package | Port | Status |
|------------------------------|--------|------|--------------------------|------|----------------|
| `homeflow` | Python | 3005 | `packages/homeflow` | 4015 | Ported (Issue #5) |
| `signalflow` | Python | CLI | `packages/signalflow` | 4002 | Partial — CLI features pending |
| `levelup-academy` | Python | 3006 | — (planned) | — | Not yet ported |
| `extropialingo` | TS | 3007 | `frontends/extropialingo` | 3007 | Frontend — needs API wiring |
| `extropy-master-control-hub` | Python | 3000 | — (see `packages/ecosystem`) | 4014 | Orchestration overlap |
| `xp-dag-mesh` | Rust | — | `packages/dag-substrate` | 4008 | TS re-implementation |
| `xp-net` | Rust | — | `packages/dag-substrate` | 4008 | Merged into dag-substrate |
| `xp-timekeeping` | Rust | — | `packages/temporal` | 4011 | TS re-implementation |

## Non-duplicate / Independent Repos

| Repo | Lang | Purpose | Integration |
|-------------------------------|--------|----------------------------------------------|-------------------------------|
| `HCS` | — | Historical / reference | None needed |
| `whiteroom-exe` | TS | Standalone experiment | None needed |
| `esp32-emergence-detector` | C++ | IoT hardware device firmware | Publishes to homeflow devices |
| `thermodynamic-revolution` | Python | Research / paper companion code | Reference only |
| `extropy-technologies-website`| HTML | Company marketing site | None needed |
| `notebook` | Jupyter | Fork of jupyter/notebook | None needed |

## Port Allocation Strategy

**Monorepo backend services:** 4001–4099
**Monorepo frontends:** 3000–3099
**Standalone Python services (legacy):** 3005–3009
**Infrastructure:** PostgreSQL 5432, Redis 6379

### Conflict Resolution Log

| Conflict | Resolution | Commit |
|----------------------------------------------|----------------------------------------------|--------|
| signalflow standalone CLI vs deployed :4002 | Standalone is CLI-only, no port conflict | — |
| homeflow :3005 vs deployed :4015 | Standalone deprecated, use monorepo | #5 |
| extropy-master-control-hub :3000 vs character-sheet :3000 | Control hub gateway proxies; frontends get own ports | — |
| loop-ledger was :4003, signalflow was :4003 | signalflow moved to :4002 | fixed |

## Feature Parity Tracker

### signalflow (Python CLI → TS service)

| Feature | Standalone | Deployed | Notes |
|---------------------------|-----------|----------|----------------------------|
| Task CRUD | ✓ | ✓ | Ported |
| Gmail integration | ✓ | ✗ | Needs bridge |
| NLP task extraction | ✓ | ✗ | spaCy → needs TS equivalent |
| MindMesh networking | ✓ | ✗ | Future Phase |
| MerchantFlow CRM | ✓ | ✗ | Future Phase |
| ZKP validation | ✓ | ✗ | Future Phase |
| InvisibleValidationMesh | ✓ | ✗ | Future Phase |
| AI personality/chat | ✓ | ✗ | Future Phase |
| Social media scraping | ✓ | ✗ | Future Phase |
| Unified auth integration | ✓ | ✓ | Both have bridge |

### homeflow (Python → TS service)

| Feature | Standalone | Deployed | Notes |
|---------------------------|-----------|----------|----------------------------|
| Inventory CRUD | ✓ | ✓ | Ported |
| Meal planning | ✓ | ✓ | Ported |
| Chore management | ✓ | ✓ | Ported |
| Health profiles | ✓ | ✓ | Ported |
| Shopping lists | ✓ | ✓ | Ported |
| Analytics dashboard | ✓ | ✓ | Ported |
| WebSocket real-time | ✓ | ✗ | Phase 3 |
| Coral device integration | ✓ | Partial | device.service.ts exists |
| Barcode scanning | ✓ | ✗ | Phase 3 |

### levelup-academy (Python → not yet ported)

| Feature | Standalone | Deployed | Notes |
|---------------------------|-----------|----------|----------------------------|
| Adaptive learning engine | ✓ | ✗ | Needs new package |
| Skill progression | ✓ | ✗ | Related to credentials pkg |
| XP rewards | ✓ | ✗ | Will use xp-mint |
| Course management | ✓ | ✗ | Needs new package |

### extropy-master-control-hub (Python → ecosystem service)

| Feature | Standalone | Deployed | Notes |
|---------------------------|-----------|----------|----------------------------|
| Service orchestration | ✓ | Partial | ecosystem pkg handles agg |
| Health monitoring | ✓ | ✗ | docker-compose healthchecks|
| Unified dashboard | ✓ | ✗ | character-sheet frontend |

## How to Run Together

```bash
# Start monorepo services
cd extropy-engine
npm run build
npm run dev

# Standalone services connect via gateway
SIGNALFLOW_GATEWAY=http://localhost:4002 python signalflow/src/main.py
HOMEFLOW_GATEWAY=http://localhost:4015 python homeflow/homeflow_service.py
```

Standalone Python services should set their gateway URLs to point at the
monorepo ports. The `unified_integration.py` bridge in each standalone repo
handles authentication and XP forwarding to the deployed services.
