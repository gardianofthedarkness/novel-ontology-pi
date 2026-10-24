FROM node:24.3.0-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends python3 ca-certificates libgomp1 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
COPY tools/pi-review/package.json tools/pi-review/package-lock.json ./tools/pi-review/
COPY apps/playground/package.json apps/playground/package-lock.json ./apps/playground/
RUN npm ci && npm ci --prefix tools/pi-review --ignore-scripts && npm ci --prefix apps/playground
COPY . .
RUN npm run build && npm run build --prefix apps/playground && mkdir -p /data && chown -R node:node /app /data
USER node
ENV PLAYGROUND_CONTAINER=1 PLAYGROUND_PORT=8080 PLAYGROUND_HOME=/data/playground
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s CMD ["node", "playground/health.mjs"]
CMD ["node", "playground/start.mjs"]
