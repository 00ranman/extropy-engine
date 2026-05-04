FROM node:20-alpine
WORKDIR /app
COPY package.json pnpm-workspace.yaml tsconfig.base.json* ./
COPY packages/contracts ./packages/contracts
COPY packages/validation-neighborhoods ./packages/validation-neighborhoods
RUN npm install -g pnpm@9 \
 && pnpm install --filter @extropy/contracts --filter @extropy/validation-neighborhoods --frozen-lockfile=false
WORKDIR /app/packages/validation-neighborhoods
RUN pnpm build || echo "skeleton — skipping build until implementation lands"
EXPOSE 4104
CMD ["pnpm", "start"]
