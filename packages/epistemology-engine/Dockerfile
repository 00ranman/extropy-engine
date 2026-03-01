# ─────────────────────────────────────────────────────────────────────────────
# Stage 1: Builder
# ─────────────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy workspace manifests first (cache layer)
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/contracts/package.json ./packages/contracts/
COPY packages/epistemology-engine/package.json ./packages/epistemology-engine/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source
COPY packages/contracts/       ./packages/contracts/
COPY packages/epistemology-engine/ ./packages/epistemology-engine/

# Build contracts first (dependency)
RUN pnpm --filter @extropy/contracts build

# Build epistemology engine
RUN pnpm --filter @extropy/epistemology-engine build

# ─────────────────────────────────────────────────────────────────────────────
# Stage 2: Production
# ─────────────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS production

WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy workspace manifests
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/contracts/package.json ./packages/contracts/
COPY packages/epistemology-engine/package.json ./packages/epistemology-engine/

# Install production deps only
RUN pnpm install --frozen-lockfile --prod

# Copy built artifacts
COPY --from=builder /app/packages/contracts/dist ./packages/contracts/dist
COPY --from=builder /app/packages/epistemology-engine/dist ./packages/epistemology-engine/dist

EXPOSE 3002

USER node

CMD ["node", "/app/packages/epistemology-engine/dist/index.js"]
