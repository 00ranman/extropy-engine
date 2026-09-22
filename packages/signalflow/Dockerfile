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
COPY packages/xp-formula/package.json packages/xp-formula/
COPY packages/validation-neighborhoods/package.json packages/validation-neighborhoods/
COPY packages/signalflow/package.json packages/signalflow/

# Install only deps for the packager slice
RUN pnpm install --frozen-lockfile \
      --filter ./packages/contracts... \
      --filter ./packages/xp-formula... \
      --filter ./packages/validation-neighborhoods... \
      --filter ./packages/signalflow...

# Source
COPY packages/contracts/  packages/contracts/
COPY packages/xp-formula/ packages/xp-formula/
COPY packages/validation-neighborhoods/ packages/validation-neighborhoods/
COPY packages/signalflow/ packages/signalflow/

# Build contracts first (shared dep), then signalflow
RUN pnpm --filter ./packages/contracts  run build \
 && pnpm --filter ./packages/xp-formula run build \
 && pnpm --filter ./packages/validation-neighborhoods run build \
 && pnpm --filter ./packages/signalflow run build

# ---------- Production stage ----------
FROM node:20-alpine AS prod
WORKDIR /app

COPY --from=base /app/node_modules ./node_modules
COPY --from=base /app/packages/contracts/dist          ./packages/contracts/dist
COPY --from=base /app/packages/contracts/package.json  ./packages/contracts/
COPY --from=base /app/packages/xp-formula/dist         ./packages/xp-formula/dist
COPY --from=base /app/packages/xp-formula/package.json ./packages/xp-formula/
COPY --from=base /app/packages/validation-neighborhoods/dist ./packages/validation-neighborhoods/dist
COPY --from=base /app/packages/validation-neighborhoods/package.json ./packages/validation-neighborhoods/
COPY --from=base /app/packages/signalflow/dist         ./packages/signalflow/dist
COPY --from=base /app/packages/signalflow/package.json ./packages/signalflow/

EXPOSE 4002
CMD ["node", "packages/signalflow/dist/index.js"]
