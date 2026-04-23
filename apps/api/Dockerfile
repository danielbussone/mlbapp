FROM node:20-bookworm-slim
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
RUN pnpm install
COPY packages/shared ./packages/shared
COPY apps/api ./apps/api
RUN pnpm --filter @mlbapp/shared build && pnpm --filter @mlbapp/api build
ENV NODE_ENV=production
WORKDIR /app/apps/api
EXPOSE 3001
CMD ["node", "dist/index.js"]
