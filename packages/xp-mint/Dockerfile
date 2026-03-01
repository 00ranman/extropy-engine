FROM node:20-alpine AS base
WORKDIR /app

COPY package.json ./
COPY packages/contracts/package.json packages/contracts/
COPY packages/epistemology-engine/package.json packages/epistemology-engine/
COPY packages/signalflow/package.json packages/signalflow/
COPY packages/loop-ledger/package.json packages/loop-ledger/
COPY packages/reputation/package.json packages/reputation/
COPY packages/xp-mint/package.json packages/xp-mint/
RUN npm install --workspaces

COPY tsconfig.json ./
COPY packages/contracts/ packages/contracts/
RUN npx tsc -p packages/contracts/tsconfig.json

COPY packages/xp-mint/ packages/xp-mint/
RUN npx tsc -p packages/xp-mint/tsconfig.json

FROM node:20-alpine
WORKDIR /app
COPY --from=base /app/node_modules ./node_modules
COPY --from=base /app/packages/contracts/dist ./packages/contracts/dist
COPY --from=base /app/packages/contracts/package.json ./packages/contracts/
COPY --from=base /app/packages/xp-mint/dist ./packages/xp-mint/dist
COPY --from=base /app/packages/xp-mint/package.json ./packages/xp-mint/

EXPOSE 4005
CMD ["node", "packages/xp-mint/dist/index.js"]
