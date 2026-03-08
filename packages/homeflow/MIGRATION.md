# HomeFlow Python → TypeScript Migration

## Status: COMPLETE

All Python standalone services from the [homeflow](https://github.com/00ranman/homeflow) repository have been fully ported to TypeScript within the Extropy Engine monorepo.

## Ported Services

| Python Module | TypeScript Equivalent | Location |
|---|---|---|
| `device_manager.py` | `device.service.ts` | `src/services/` |
| `household_manager.py` | `household.service.ts` | `src/services/` |
| `claim_processor.py` | `claim.service.ts` | `src/services/` |
| `event_bus.py` | `event-bus.service.ts` | `src/services/` |
| `entropy_calc.py` | `entropy.service.ts` | `src/services/` |
| `database.py` | `database.service.ts` | `src/services/` |
| `analytics.py` | `analytics.service.ts` | `src/services/` |
| `chore_manager.py` | `chore.service.ts` | `src/services/` |
| `health_tracker.py` | `health.service.ts` | `src/services/` |
| `inventory.py` | `inventory.service.ts` | `src/services/` |
| `meal_planner.py` | `meal.service.ts` | `src/services/` |
| `shopping_list.py` | `shopping-list.service.ts` | `src/services/` |

## Key Improvements Over Python Version

- Full static typing with TypeScript interfaces
- Express HTTP router layer (`src/routes/`)
- Integration adapters for ecosystem services (`src/integrations/`)
- Interop bridge to extropy-engine event bus (`src/interop/`)
- OpenAPI spec (`openapi.yaml`) for contract-first development
- Docker Compose configuration for local orchestration

## Deprecation

The standalone Python `homeflow` repository is deprecated and should not receive new features.
All development continues in `packages/homeflow` within this monorepo.
