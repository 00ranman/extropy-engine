FROM node:20-alpine AS base
WORKDIR /app

# ── Install dependencies ──────────────────────────────────────────────────────────
FROM base AS deps
COPY package.json package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/epistemology-engine/package.json packages/epistemology-engine/package.json
RUN npm install --workspace=packages/contracts --workspace=packages/epistemology-engine

# ── Build ────────────────────────────────────────────────────────────────────
FROM deps AS builder
COPY tsconfig.json tsconfig.json
COPY packages/contracts/tsconfig.json packages/contracts/tsconfig.json
COPY packages/contracts/src packages/contracts/src
COPY packages/epistemology-engine/tsconfig.json packages/epistemology-engine/tsconfig.json
COPY packages/epistemology-engine/src packages/epistemology-engine/src
RUN npm run build -w packages/contracts && npm run build -w packages/epistemology-engine

# ── Runtime ───────────────────────────────────────────────────────────────────
FROM node:20-alpine AS runtime
WORKDIR /app
COPY --from=builder /app/packages/contracts/dist packages/contracts/dist
COPY --from=builder /app/packages/contracts/package.json packages/contracts/package.json
COPY --from=builder /app/packages/epistemology-engine/dist packages/epistemology-engine/dist
COPY --from=builder /app/packages/epistemology-engine/package.json packages/epistemology-engine/package.json
COPY --from=builder /app/node_modules node_modules
COPY --from=builder /app/package.json package.json
EXPOSE 4001
CMD ["node", "packages/epistemology-engine/dist/index.js"]
