# syntax=docker/dockerfile:1.7
FROM node:20-alpine AS base
WORKDIR /app

# Enable pnpm via corepack (this repo uses pnpm workspaces, not npm workspaces)
RUN corepack enable && corepack prepare pnpm@9 --activate

# Workspace root files (build context = repo root, per ci.yml docker-build job)
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY .npmrc tsconfig.base.json ./

# Manifests for the slice we need to build
COPY packages/contracts/package.json packages/contracts/
COPY packages/identity/package.json  packages/identity/
COPY packages/homeflow/package.json  packages/homeflow/

# Install only deps for contracts + identity + homeflow (and their transitives)
RUN pnpm install --frozen-lockfile \
      --filter ./packages/contracts... \
      --filter ./packages/identity... \
      --filter ./packages/homeflow...

# Source
COPY packages/contracts/ packages/contracts/
COPY packages/identity/  packages/identity/
COPY packages/homeflow/  packages/homeflow/
COPY frontends/homeflow-ui/ frontends/homeflow-ui/

# Build contracts and identity first (shared deps), then homeflow
RUN pnpm --filter ./packages/contracts run build \
 && pnpm --filter ./packages/identity  run build \
 && pnpm --filter ./packages/homeflow  run build

# ---------- Production stage ----------
FROM node:20-alpine AS prod
WORKDIR /app

COPY --from=base /app/node_modules ./node_modules
COPY --from=base /app/packages/contracts/dist         ./packages/contracts/dist
COPY --from=base /app/packages/contracts/package.json ./packages/contracts/
COPY --from=base /app/packages/identity/dist          ./packages/identity/dist
COPY --from=base /app/packages/identity/package.json  ./packages/identity/
COPY --from=base /app/packages/homeflow/dist          ./packages/homeflow/dist
COPY --from=base /app/packages/homeflow/package.json  ./packages/homeflow/
COPY --from=base /app/frontends/homeflow-ui          ./frontends/homeflow-ui

EXPOSE 4015
CMD ["node", "packages/homeflow/dist/index.js"]
