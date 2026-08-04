FROM node:20-bookworm-slim AS build
WORKDIR /app

RUN corepack enable

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json turbo.json ./
COPY apps ./apps
COPY packages ./packages

RUN pnpm install --frozen-lockfile
RUN pnpm --filter '!@mavio/web' -r build

# Deploy prunes down to server-only production tree
RUN pnpm --filter @mavio/server --prod deploy /out

FROM node:20-bookworm-slim AS runtime
WORKDIR /app

RUN useradd -u 1000 -m mavio
COPY --from=build --chown=mavio:mavio /out /app
USER mavio

ENV NODE_ENV=production \
    MAVIO_HTTP_PORT=4000 \
    MAVIO_CONFIG=/etc/mavio/mavio.config.yaml

EXPOSE 4000
CMD ["node", "dist/main.js"]
