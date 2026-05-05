# Stage 1: Vite build
FROM node:24-alpine AS builder
RUN corepack enable
WORKDIR /app

# Copy manifests for layer caching
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY packages/tsconfig/package.json packages/tsconfig/
COPY packages/schemas/package.json packages/schemas/
COPY apps/web/package.json apps/web/

RUN pnpm install --frozen-lockfile

# Copy sources (schemas needed by Vite at build time)
COPY packages/schemas/src packages/schemas/src
COPY apps/web/ apps/web/

ARG VITE_API_BASE_URL=/api
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL

RUN pnpm --filter @delivery/web build

# Stage 2: nginx serves the static bundle
FROM nginx:alpine
COPY --from=builder /app/apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
