FROM node:22-trixie-slim AS builder

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ bubblewrap socat ripgrep \
  && rm -rf /var/lib/apt/lists/*

COPY . .

RUN npm install --ignore-scripts
RUN npm run sandboxprepare -- --base-dir /opt/senera/sandbox-runtime --bundle-dir /opt/senera/sandbox-bundles --skip-image-pull
RUN npm run build
RUN npm --workspace senera-frontend run build
RUN npm prune --omit=dev

FROM node:22-trixie-slim AS runtime

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
COPY --from=builder /opt/senera/sandbox-runtime /opt/senera/sandbox-runtime
COPY --from=builder /opt/senera/sandbox-bundles /opt/senera/sandbox-bundles

RUN mkdir -p /data

VOLUME ["/data"]
EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD node -e "const port = process.env.SENERA_SERVER_PORT || 8787; fetch('http://127.0.0.1:' + port + '/').then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1));"

CMD ["node", "Dist/Apps/DockerServer.js"]
