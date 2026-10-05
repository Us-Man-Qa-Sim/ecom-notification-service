# syntax=docker/dockerfile:1.7

# ── Stage 1: build ──
FROM node:24.21.0-alpine AS build
WORKDIR /app

# Toolchain for native deps (e.g. @swc/core, @confluentinc/kafka-javascript).
RUN apk add --no-cache python3 make g++

COPY package.json package-lock.json* .npmrc ./
RUN npm ci

COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src
RUN npm run build

# Prune dev deps for the runtime layer.
RUN npm prune --omit=dev

# ── Stage 2: runtime ──
FROM node:24.21.0-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production

RUN addgroup -S app -g 1001 \
 && adduser  -S app -G app -u 1001

COPY --from=build --chown=app:app /app/node_modules ./node_modules
COPY --from=build --chown=app:app /app/dist ./dist
COPY --from=build --chown=app:app /app/package.json ./package.json
COPY --chown=app:app docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh

USER app

EXPOSE 8084

HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -q -O /dev/null "http://127.0.0.1:${HTTP_PORT:-8084}/health" || exit 1

ENTRYPOINT ["./docker-entrypoint.sh"]
