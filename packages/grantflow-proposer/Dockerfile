# ═══════════════════════════════════════════════════════════════════════════════
#  GrantFlow Proposer — Dockerfile
# ═══════════════════════════════════════════════════════════════════════════════
#
#  Multi-stage build:
#    1. deps    — Install production + dev dependencies
#    2. builder — Compile TypeScript to JavaScript
#    3. runner  — Minimal production image with only compiled output
#
# ═══════════════════════════════════════════════════════════════════════════════

# ── Stage 1: Dependencies ──────────────────────────────────────────────────
FROM node:20-alpine AS deps

WORKDIR /app

# Copy workspace root package files for monorepo context
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml* ./
COPY packages/contracts/package.json ./packages/contracts/
COPY packages/grantflow-proposer/package.json ./packages/grantflow-proposer/

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Install all dependencies (including dev for build)
RUN pnpm install --frozen-lockfile

# ── Stage 2: Builder ───────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Copy installed node_modules from deps stage
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/contracts/node_modules ./packages/contracts/node_modules 2>/dev/null || true
COPY --from=deps /app/packages/grantflow-proposer/node_modules ./packages/grantflow-proposer/node_modules 2>/dev/null || true

# Copy source code
COPY tsconfig.json ./
COPY packages/contracts/ ./packages/contracts/
COPY packages/grantflow-proposer/ ./packages/grantflow-proposer/

# Build contracts package first (dependency)
RUN cd packages/contracts && npx tsc --build

# Build grantflow-proposer
RUN cd packages/grantflow-proposer && npx tsc --build

# ── Stage 3: Runner ────────────────────────────────────────────────────────
FROM node:20-alpine AS runner

# Install dumb-init for proper signal handling
RUN apk add --no-cache dumb-init

WORKDIR /app

# Create non-root user
RUN addgroup --system --gid 1001 extropy && \
    adduser  --system --uid  1001 proposer

# Copy compiled output
COPY --from=builder --chown=proposer:extropy /app/packages/grantflow-proposer/dist ./dist
COPY --from=builder --chown=proposer:extropy /app/packages/contracts/dist           ./packages/contracts/dist
COPY --from=builder --chown=proposer:extropy /app/packages/grantflow-proposer/package.json ./
COPY --from=builder --chown=proposer:extropy /app/packages/grantflow-proposer/migrations   ./migrations

# Install only production dependencies in the final image
COPY --from=deps /app/packages/grantflow-proposer/node_modules ./node_modules

# Set permissions
RUN chown -R proposer:extropy /app

USER proposer

# Expose the service port
EXPOSE 4021

# Healthcheck
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:4021/health || exit 1

# Environment defaults (override in docker-compose or Kubernetes)
ENV NODE_ENV=production
ENV PORT=4021

# Start with dumb-init for proper PID 1 signal handling
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/index.js"]
