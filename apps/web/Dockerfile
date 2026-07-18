# syntax=docker/dockerfile:1
# Build context is the repo root (see docker-compose.yml `context: .`).
#
# Build stage: compile @mlbapp/shared then build the Vite SPA to static files.
FROM node:20-bookworm-slim AS build
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate
WORKDIR /app

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
RUN pnpm install --frozen-lockfile

COPY packages/shared ./packages/shared
COPY apps/web ./apps/web
RUN pnpm --filter @mlbapp/shared build && pnpm --filter @mlbapp/web build

# Serve stage: nginx serves the SPA and reverse-proxies /api (see nginx.conf).
FROM nginx:1.27-alpine
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
