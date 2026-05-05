# syntax=docker/dockerfile:1.7
FROM node:20-alpine AS base
WORKDIR /app

# Enable pnpm via corepack (this repo uses pnpm workspaces, not npm workspaces)
RUN corepack enable && corepack prepare pnpm@9 --activate

# Workspace root files (build context = repo root, per ci.yml docker-build job)
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY .npmrc tsconfig.base.json ./

# Manifests for the slice we need to build
COPY packages/contracts/package.json  packages/contracts/
COPY packages/signalflow/package.json packages/signalflow/

# Install only deps for contracts + signalflow (and their transitives)
RUN pnpm install --frozen-lockfile \
      --filter ./packages/contracts... \
      --filter ./packages/signalflow...

# Source
COPY packages/contracts/  packages/contracts/
COPY packages/signalflow/ packages/signalflow/

# Build contracts first (shared dep), then signalflow
RUN pnpm --filter ./packages/contracts  run build \
 && pnpm --filter ./packages/signalflow run build

# ---------- Production stage ----------
FROM node:20-alpine AS prod
WORKDIR /app

COPY --from=base /app/node_modules ./node_modules
COPY --from=base /app/packages/contracts/dist          ./packages/contracts/dist
COPY --from=base /app/packages/contracts/package.json  ./packages/contracts/
COPY --from=base /app/packages/signalflow/dist         ./packages/signalflow/dist
COPY --from=base /app/packages/signalflow/package.json ./packages/signalflow/

EXPOSE 4002
CMD ["node", "packages/signalflow/dist/index.js"]
