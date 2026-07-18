# syntax=docker/dockerfile:1
# Build context is the repo root (see docker-compose.yml `context: .`).
#
# Build stage: install the pnpm workspace, compile @mlbapp/shared + @mlbapp/api,
# then emit a self-contained production bundle (flattened, de-symlinked node_modules)
# with `pnpm deploy`. The runtime stage carries only that bundle — no build toolchain,
# dev deps, or source.
FROM node:20-bookworm-slim AS build
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate
WORKDIR /app

# Copy manifests first so `pnpm install` caches across source-only changes.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
RUN pnpm install --frozen-lockfile

# api imports @mlbapp/shared/dist, so shared must build first.
COPY packages/shared ./packages/shared
COPY apps/api ./apps/api
RUN pnpm --filter @mlbapp/shared build \
 && pnpm --filter @mlbapp/api build \
 && pnpm --filter @mlbapp/api deploy --prod /prod

# Runtime stage: just Node + the prod bundle.
FROM node:20-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /prod ./
USER node
EXPOSE 3001

# PORT (default 3001), DATABASE_URL, CHAT_PROVIDER, OPENAI_*/AWS_* come from the environment.
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/index.js"]
