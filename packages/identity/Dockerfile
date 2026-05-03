FROM node:20-alpine
WORKDIR /app

# Workspace context: built from monorepo root via docker-compose
COPY package.json pnpm-workspace.yaml tsconfig.base.json* ./
COPY packages/contracts ./packages/contracts
COPY packages/identity ./packages/identity

RUN npm install -g pnpm@9 \
 && pnpm install --filter @extropy/contracts --filter @extropy/identity --frozen-lockfile=false

WORKDIR /app/packages/identity
RUN pnpm build || echo "skeleton — skipping build until implementation lands"

EXPOSE 4101
CMD ["pnpm", "start"]
