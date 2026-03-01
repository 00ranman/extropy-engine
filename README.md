# Extropy Engine

Civilisational-scale intelligence infrastructure. A modular TypeScript monorepo of microservices that track belief formation, signal propagation, feedback loops, reputation, and experience minting.

## Architecture

```
extropy-engine/
├── packages/
│   ├── contracts/              # Shared types, DB client, event bus
│   ├── epistemology-engine/   # Belief & user management (port 4001)
│   ├── signal-flow/           # Signal detection & routing (port 4002)
│   ├── loop-ledger/           # Feedback loop tracking (port 4003)
│   ├── reputation/            # Reputation scoring (port 4004)
│   └── xp-mint/               # XP minting & ledger (port 4005)
├── docker-compose.yml
├── package.json
├── tsconfig.json
└── .env.example
```

## Services

| Service | Port | Responsibility |
|---------|------|----------------|
| epistemology-engine | 4001 | Beliefs, user profiles, epistemic state |
| signal-flow | 4002 | Signal detection, classification, routing |
| loop-ledger | 4003 | Feedback loop lifecycle management |
| reputation | 4004 | Reputation scoring & history |
| xp-mint | 4005 | XP minting, ledger, rewards |

## Quick Start

```bash
# 1. Copy environment config
cp .env.example .env

# 2. Start infrastructure
docker-compose up -d postgres redis

# 3. Install dependencies
npm install

# 4. Build shared contracts
npm run build -w packages/contracts

# 5. Start all services
npm run dev
```

## Development

```bash
# Build all packages
npm run build

# Run tests
npm test

# Start specific service
npm run dev -w packages/epistemology-engine
```

## Integration Tests

All 12 integration tests pass:

```
✔ POST /beliefs → creates belief, publishes event
✔ GET /beliefs/:id → returns belief
✔ PUT /beliefs/:id → updates belief, republishes
✔ GET /users/:id/beliefs → returns user belief set
✔ POST /signals → creates signal from belief event
✔ GET /signals → returns signal list
✔ POST /loops → creates feedback loop
✔ PUT /loops/:id/close → closes loop, triggers reputation + XP
✔ GET /scores/:userId → returns reputation score
✔ POST /mint → mints XP, records ledger entry
✔ GET /balance/:userId → returns XP balance
✔ GET /health (all services) → all return 200
```
