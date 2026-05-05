# syntax=docker/dockerfile:1.7
FROM node:20-alpine AS base
WORKDIR /app

# Enable pnpm via corepack (this repo uses pnpm workspaces, not npm workspaces)
RUN corepack enable && corepack prepare pnpm@9 --activate

# Workspace root files (build context = repo root, per ci.yml docker-build job)
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY .npmrc tsconfig.base.json ./

# Manifests for the slice xp-mint needs
COPY packages/contracts/package.json            packages/contracts/
COPY packages/epistemology-engine/package.json  packages/epistemology-engine/
COPY packages/signalflow/package.json           packages/signalflow/
COPY packages/loop-ledger/package.json          packages/loop-ledger/
COPY packages/reputation/package.json           packages/reputation/
COPY packages/xp-mint/package.json              packages/xp-mint/

# Install only deps for xp-mint and its workspace deps (transitives included via ...)
RUN pnpm install --frozen-lockfile \
      --filter ./packages/xp-mint...

# Source for xp-mint and its workspace deps
COPY packages/contracts/           packages/contracts/
COPY packages/epistemology-engine/ packages/epistemology-engine/
COPY packages/signalflow/          packages/signalflow/
COPY packages/loop-ledger/         packages/loop-ledger/
COPY packages/reputation/          packages/reputation/
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
