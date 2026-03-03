FROM node:20-alpine AS base
WORKDIR /app

# Copy all package.json files for workspace resolution
COPY package.json ./
COPY packages/contracts/package.json packages/contracts/
COPY packages/homeflow/package.json packages/homeflow/
RUN npm install --workspaces

# Build contracts first (shared dependency)
COPY tsconfig.json ./
COPY packages/contracts/ packages/contracts/
RUN npx tsc -p packages/contracts/tsconfig.json

# Build the service
COPY packages/homeflow/ packages/homeflow/
RUN npx tsc -p packages/homeflow/tsconfig.json

# Production stage
FROM node:20-alpine
WORKDIR /app
COPY --from=base /app/node_modules ./node_modules
COPY --from=base /app/packages/contracts/dist ./packages/contracts/dist
COPY --from=base /app/packages/contracts/package.json ./packages/contracts/
COPY --from=base /app/packages/homeflow/dist ./packages/homeflow/dist
COPY --from=base /app/packages/homeflow/package.json ./packages/homeflow/

EXPOSE 4015
CMD ["node", "packages/homeflow/dist/index.js"]
