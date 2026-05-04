FROM node:20-alpine
WORKDIR /app
COPY package.json pnpm-workspace.yaml tsconfig.base.json* ./
COPY packages/contracts ./packages/contracts
COPY packages/quest-market ./packages/quest-market
RUN npm install -g pnpm@9 \
 && pnpm install --filter @extropy/contracts --filter @extropy/quest-market --frozen-lockfile=false
WORKDIR /app/packages/quest-market
RUN pnpm build || echo "skeleton — skipping build until implementation lands"
EXPOSE 4103
CMD ["pnpm", "start"]
