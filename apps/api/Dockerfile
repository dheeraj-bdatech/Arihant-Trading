# Multi-stage Dockerfile for Arihant BOS Backend (NestJS API)
FROM node:20-alpine AS builder
RUN npm install -g pnpm@9.15.4

WORKDIR /app

# Copy dependency manifests
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/

# Install dependencies with lockfile
RUN pnpm install --frozen-lockfile

# Copy source files
COPY packages/shared ./packages/shared
COPY apps/api ./apps/api
COPY db ./db

# Build shared and api
RUN pnpm --filter @arihant/shared build && \
    pnpm --filter @arihant/api build

# Stage 2: Production Runner
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=4000
ENV WS_PORT=4001

COPY --from=builder /app ./

WORKDIR /app/apps/api

EXPOSE 4000
EXPOSE 4001

CMD ["sh", "-c", "node_modules/.bin/tsx ../../db/migrate.ts || true; node dist/main.js"]
