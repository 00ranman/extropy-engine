# syntax=docker/dockerfile:1.7
FROM node:20-alpine AS base
WORKDIR /app

# Enable pnpm via corepack (this repo uses pnpm workspaces, not npm workspaces)
RUN corepack enable && corepack prepare pnpm@9 --activate

# Workspace root files (build context = repo root, per ci.yml docker-build job)
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY .npmrc tsconfig.base.json ./

# All workspace manifests (pnpm --frozen-lockfile validates against the full
# workspace, so every package.json must be present at install time even when
# we only --filter a subset).
COPY packages/academia-bridge/package.json         packages/academia-bridge/
COPY packages/api-gateway/package.json             packages/api-gateway/
COPY packages/bayesian/package.json                packages/bayesian/
COPY packages/contracts/package.json               packages/contracts/
COPY packages/credentials/package.json             packages/credentials/
COPY packages/dag-substrate/package.json           packages/dag-substrate/
COPY packages/decomposition-kit/package.json       packages/decomposition-kit/
COPY packages/dfao-registry/package.json           packages/dfao-registry/
COPY packages/ecosystem/package.json               packages/ecosystem/
COPY packages/epistemology-engine/package.json     packages/epistemology-engine/
COPY packages/ethics/package.json                  packages/ethics/
COPY packages/extropialingo/package.json           packages/extropialingo/
COPY packages/governance/package.json              packages/governance/
COPY packages/grantflow-discovery/package.json     packages/grantflow-discovery/
COPY packages/grantflow-proposer/package.json      packages/grantflow-proposer/
COPY packages/homeflow/package.json                packages/homeflow/
COPY packages/identity/package.json                packages/identity/
COPY packages/levelup-academy/package.json         packages/levelup-academy/
COPY packages/loop-ledger/package.json             packages/loop-ledger/
COPY packages/node-handshake/package.json          packages/node-handshake/
COPY packages/psll-sync/package.json               packages/psll-sync/
COPY packages/quest-market/package.json            packages/quest-market/
COPY packages/reputation/package.json              packages/reputation/
COPY packages/signalflow/package.json              packages/signalflow/
COPY packages/temporal/package.json                packages/temporal/
COPY packages/token-economy/package.json           packages/token-economy/
COPY packages/validation-neighborhoods/package.json packages/validation-neighborhoods/
COPY packages/xp-formula/package.json              packages/xp-formula/
COPY packages/xp-mint/package.json                 packages/xp-mint/

# Install only deps for xp-mint and its workspace deps (transitives via ...)
RUN pnpm install --frozen-lockfile \
      --filter ./packages/xp-mint...

# Source: only what xp-mint actually needs to build (it depends only on contracts)
COPY packages/contracts/           packages/contracts/
COPY packages/xp-mint/             packages/xp-mint/

# Build dep graph leading to xp-mint
RUN pnpm --filter ./packages/xp-mint... run build

# ---------- Production stage ----------
FROM node:20-alpine AS prod
WORKDIR /app

COPY --from=base /app/node_modules ./node_modules
COPY --from=base /app/packages/contracts/dist           ./packages/contracts/dist
COPY --from=base /app/packages/contracts/package.json   ./packages/contracts/
COPY --from=base /app/packages/xp-mint/dist             ./packages/xp-mint/dist
COPY --from=base /app/packages/xp-mint/package.json     ./packages/xp-mint/

EXPOSE 4005
CMD ["node", "packages/xp-mint/dist/index.js"]
