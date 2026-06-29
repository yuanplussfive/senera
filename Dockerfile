FROM node:22-bookworm-slim AS builder

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY . .

RUN npm install
RUN npm run build
RUN npm --workspace senera-frontend run build
RUN npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime

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

RUN mkdir -p /data

VOLUME ["/data"]
EXPOSE 8787

CMD ["node", "Dist/Apps/DockerServer.js"]
