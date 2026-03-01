FROM node:20-alpine AS base
WORKDIR /app

# Copy all package.json files for workspace resolution
COPY package.json ./
COPY packages/contracts/package.json packages/contracts/
COPY packages/epistemology-engine/package.json packages/epistemology-engine/
COPY packages/signalflow/package.json packages/signalflow/
COPY packages/loop-ledger/package.json packages/loop-ledger/
COPY packages/reputation/package.json packages/reputation/
COPY packages/xp-mint/package.json packages/xp-mint/
RUN npm install --workspaces

# Build contracts first (shared dependency)
COPY tsconfig.json ./
COPY packages/contracts/ packages/contracts/
RUN npx tsc -p packages/contracts/tsconfig.json

# Build the service
COPY packages/epistemology-engine/ packages/epistemology-engine/
RUN npx tsc -p packages/epistemology-engine/tsconfig.json

# Production stage
FROM node:20-alpine
WORKDIR /app
COPY --from=base /app/node_modules ./node_modules
COPY --from=base /app/packages/contracts/dist ./packages/contracts/dist
COPY --from=base /app/packages/contracts/package.json ./packages/contracts/
COPY --from=base /app/packages/epistemology-engine/dist ./packages/epistemology-engine/dist
COPY --from=base /app/packages/epistemology-engine/package.json ./packages/epistemology-engine/

EXPOSE 4001
CMD ["node", "packages/epistemology-engine/dist/index.js"]
