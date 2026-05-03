FROM node:20-alpine
WORKDIR /app
COPY package.json pnpm-workspace.yaml tsconfig.base.json* ./
COPY packages/contracts ./packages/contracts
COPY packages/node-handshake ./packages/node-handshake
RUN npm install -g pnpm@9 \
 && pnpm install --filter @extropy/contracts --filter @extropy/node-handshake --frozen-lockfile=false
WORKDIR /app/packages/node-handshake
RUN pnpm build || echo "skeleton — skipping build until implementation lands"
EXPOSE 4200
CMD ["pnpm", "start"]
