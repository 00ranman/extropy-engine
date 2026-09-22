FROM node:20-alpine
WORKDIR /app
COPY package.json pnpm-workspace.yaml tsconfig.base.json* ./
COPY packages/contracts ./packages/contracts
COPY packages/xp-formula ./packages/xp-formula
COPY packages/validation-neighborhoods ./packages/validation-neighborhoods
COPY packages/signalflow ./packages/signalflow
COPY packages/merchant-till ./packages/merchant-till
RUN npm install -g pnpm@9 \
 && pnpm install --filter @extropy/xp-formula --filter @extropy/validation-neighborhoods --filter @extropy/signalflow --filter @extropy/merchant-till --frozen-lockfile=false
WORKDIR /app/packages/merchant-till
RUN pnpm --filter @extropy/xp-formula build \
 && pnpm --filter @extropy/validation-neighborhoods build \
 && pnpm --filter @extropy/signalflow build \
 && pnpm build
EXPOSE 4031
CMD ["pnpm", "start"]
