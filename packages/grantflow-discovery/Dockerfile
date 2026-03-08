# ─────────────────────────────────────────────────────────────────────────────
#  Extropy Engine — grantflow-discovery
#  Multi-stage build for production-optimised image
# ─────────────────────────────────────────────────────────────────────────────

# Stage 1: Builder
FROM node:20-alpine AS builder

WORKDIR /app

# Copy root workspace config
COPY package.json ./
COPY tsconfig.json ./

# Copy packages
COPY packages/contracts ./packages/contracts
COPY packages/grantflow-discovery ./packages/grantflow-discovery

# Install dependencies
RUN npm install --workspaces --if-present

# Build contracts first, then the service
RUN npm run build --workspace=packages/contracts
RUN npm run build --workspace=packages/grantflow-discovery

# ─────────────────────────────────────────────────────────────────────────────
# Stage 2: Runtime
FROM node:20-alpine AS runtime

WORKDIR /app

ENV NODE_ENV=production

# Copy built artifacts + dependencies
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/contracts/dist ./packages/contracts/dist
COPY --from=builder /app/packages/contracts/package.json ./packages/contracts/package.json
COPY --from=builder /app/packages/grantflow-discovery/dist ./packages/grantflow-discovery/dist
COPY --from=builder /app/packages/grantflow-discovery/package.json ./packages/grantflow-discovery/package.json
COPY --from=builder /app/packages/grantflow-discovery/migrations ./packages/grantflow-discovery/migrations

WORKDIR /app/packages/grantflow-discovery

EXPOSE 4020

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD wget -qO- http://localhost:4020/health || exit 1

CMD ["node", "dist/index.js"]
