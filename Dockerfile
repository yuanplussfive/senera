# syntax=docker/dockerfile:1.7

ARG NODE_IMAGE=node:22-trixie-slim

FROM ${NODE_IMAGE} AS builder

WORKDIR /app

RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
  --mount=type=cache,target=/var/lib/apt/lists,sharing=locked \
  apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ bubblewrap socat ripgrep

COPY package.json package-lock.json .npmrc ./
COPY Frontend/package.json ./Frontend/package.json
COPY Packages ./Packages
COPY System/Plugins ./System/Plugins
COPY Plugins ./Plugins

RUN --mount=type=cache,target=/root/.npm,sharing=locked npm ci --ignore-scripts
RUN --mount=type=cache,target=/root/.npm,sharing=locked npm rebuild better-sqlite3 --build-from-source

COPY . .

RUN npm run build
RUN npm --workspace senera-frontend run build
RUN --mount=type=cache,target=/root/.npm,sharing=locked npm prune --omit=dev
RUN node Dist/Scripts/VerifyDockerNativeSqlite.js

FROM ${NODE_IMAGE} AS runtime

WORKDIR /app

ENV NODE_ENV=production
ENV SENERA_WORKSPACE_ROOT=/data
ENV AGENT_CONFIG_PATH=/data/senera.config.json
ENV SENERA_SERVER_HOST=0.0.0.0
ENV SENERA_SERVER_PORT=8787

COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/Dist ./Dist
COPY --from=builder /app/Frontend/dist ./Frontend/dist
COPY --from=builder /app/System ./System
COPY --from=builder /app/Plugins ./Plugins
COPY --from=builder /app/Packages ./Packages
COPY --from=builder /app/senera.config.example.json ./senera.config.example.json

RUN mkdir -p /data/Plugins \
  && chown -R node:node /data /app/Frontend/dist

USER node

VOLUME ["/data"]
EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD node -e "const port = process.env.SENERA_SERVER_PORT || 8787; fetch('http://127.0.0.1:' + port + '/').then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1));"

CMD ["node", "Dist/Apps/DockerServer.js"]
