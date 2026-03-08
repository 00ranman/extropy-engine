# ════════════════════════════════════════════════════════════════════════════════
#  EXTROPY ENGINE — Academia Bridge | Dockerfile
# ════════════════════════════════════════════════════════════════════════════════
#
#  Multi-stage build:
#    1. builder  — installs dependencies and compiles TypeScript
#    2. production — minimal runtime image with Playwright Chromium
#
#  Important: Playwright's headless Chromium is installed in the production stage
#  so the browser automation (academia.edu upload workflow) works at runtime.
#
# ════════════════════════════════════════════════════════════════════════════════

# ── Stage 1: Build ──────────────────────────────────────────────────────────
FROM node:20-slim AS builder

WORKDIR /app

# Copy workspace root config files
COPY package.json ./
COPY tsconfig.json ./

# Copy contracts package (dependency)
COPY packages/contracts ./packages/contracts

# Copy academia-bridge source
COPY packages/academia-bridge ./packages/academia-bridge

# Install all workspace dependencies
RUN npm install --workspace=packages/contracts --workspace=packages/academia-bridge

# Build contracts first (academia-bridge depends on it)
RUN npm run build --workspace=packages/contracts 2>/dev/null || true

# Build academia-bridge
RUN npm run build --workspace=packages/academia-bridge

# ── Stage 2: Production ─────────────────────────────────────────────────────
FROM node:20-slim AS production

# Install system dependencies required by Playwright/Chromium
RUN apt-get update && apt-get install -y \
    # Chromium runtime dependencies
    libnss3 \
    libnspr4 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libdbus-1-3 \
    libatspi2.0-0 \
    libx11-6 \
    libxcomposite1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libxcb1 \
    libxkbcommon0 \
    libpango-1.0-0 \
    libcairo2 \
    libasound2 \
    # Fonts for rendering
    fonts-liberation \
    fonts-noto-color-emoji \
    # Utilities
    wget \
    ca-certificates \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy built artifacts and production dependencies from builder
COPY --from=builder /app/packages/academia-bridge/dist ./packages/academia-bridge/dist
COPY --from=builder /app/packages/academia-bridge/package.json ./packages/academia-bridge/
COPY --from=builder /app/packages/contracts/dist ./packages/contracts/dist
COPY --from=builder /app/packages/contracts/package.json ./packages/contracts/
COPY --from=builder /app/package.json ./

# Install only production dependencies
RUN npm install --workspace=packages/academia-bridge --workspace=packages/contracts --omit=dev

# Install Playwright browsers in the production stage
ENV PLAYWRIGHT_BROWSERS_PATH=/app/.playwright-browsers
RUN npx playwright install --with-deps chromium

# Runtime configuration
ENV NODE_ENV=production
ENV PORT=4022

# Non-root user for security
RUN groupadd -r extropy && useradd -r -g extropy -d /app extropy
RUN chown -R extropy:extropy /app
USER extropy

EXPOSE 4022

HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
  CMD wget -qO- http://localhost:4022/health || exit 1

CMD ["node", "packages/academia-bridge/dist/index.js"]
