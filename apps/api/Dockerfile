# Stage 1: install all workspace deps and create a self-contained production bundle
FROM node:24-alpine AS builder
RUN corepack enable
WORKDIR /app

# Copy manifests first for layer caching
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY packages/tsconfig/package.json packages/tsconfig/
COPY packages/schemas/package.json packages/schemas/
COPY packages/simulation/package.json packages/simulation/
COPY apps/api/package.json apps/api/

RUN pnpm install --frozen-lockfile

# Copy sources
COPY packages/ packages/
COPY apps/api/ apps/api/

# pnpm deploy creates a flat self-contained directory:
# node_modules/ with all prod deps (workspace packages copied inline, not symlinked)
RUN pnpm deploy --filter @delivery/api --prod --legacy /deploy/api

# Stage 2: slim runtime image
FROM node:24-alpine
RUN corepack enable
WORKDIR /app

COPY --from=builder /deploy/api .

EXPOSE 3000
# tsx runs TypeScript source directly; workspace packages are inlined in node_modules
CMD ["node_modules/.bin/tsx", "src/index.ts"]
