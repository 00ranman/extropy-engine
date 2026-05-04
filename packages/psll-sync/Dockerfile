FROM node:20-alpine
WORKDIR /app
COPY package.json pnpm-workspace.yaml tsconfig.base.json* ./
COPY packages/contracts ./packages/contracts
COPY packages/psll-sync ./packages/psll-sync
RUN npm install -g pnpm@9 \
 && pnpm install --filter @extropy/contracts --filter @extropy/psll-sync --frozen-lockfile=false
WORKDIR /app/packages/psll-sync
RUN pnpm build || echo "skeleton — skipping build until implementation lands"
EXPOSE 4102
CMD ["pnpm", "start"]
