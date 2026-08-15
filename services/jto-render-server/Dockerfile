# jto-render-server — one image, two rendering back-ends behind one port:
#   POST /rasterize  → pptx slide → PNG   (LibreOffice + poppler)
#   /export, …       → Highcharts Export Server (Chromium), reverse-proxied
#
# The Node front server (packages/jto/dist/render-server.js) owns the public
# port; highcharts-export-server runs internally on :7801.

# ── Stage 1: build the monorepo (jto render-server + jto-cli + core-pptx) ──
FROM node:20-slim AS builder

RUN npm i -g pnpm@9.15.9
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json tsconfig*.json ./
COPY scripts/ scripts/
COPY packages/ packages/
RUN pnpm install --frozen-lockfile
RUN pnpm build

# ── Stage 2: runtime — Chromium (highcharts) + LibreOffice/poppler (rasterizer) ──
FROM node:20-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    fonts-liberation \
    libreoffice-core \
    libreoffice-impress \
    poppler-utils \
    && rm -rf /var/lib/apt/lists/*

# ── Highcharts Export Server (unchanged from the standalone image) ──
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV POOL_MIN_WORKERS=1
ENV POOL_MAX_WORKERS=1
ENV POOL_CREATE_TIMEOUT=30000
ENV POOL_ACQUIRE_TIMEOUT=30000

RUN npm install -g highcharts-export-server@5.1.0

RUN mkdir -p /usr/src/app && \
    echo '{\
  "puppeteer": {\
    "executablePath": "/usr/bin/chromium",\
    "args": [\
      "--disable-dev-shm-usage",\
      "--disable-gpu",\
      "--disable-features=VizDisplayCompositor",\
      "--disable-extensions",\
      "--disable-background-timer-throttling",\
      "--disable-renderer-backgrounding",\
      "--disable-backgrounding-occluded-windows"\
    ]\
  },\
  "server": {\
    "enable": true,\
    "host": "127.0.0.1",\
    "port": 7801\
  }\
}' > /usr/src/app/config.json

# Cache-warming: downloads Highcharts JS modules. Browser launch fails at build
# time (no sandbox in Docker build), but the module cache is still written.
RUN highcharts-export-server --noLogo 1 --enableServer 0 --loadConfig /usr/src/app/config.json || true
RUN cp -r /usr/local/lib/node_modules/highcharts-export-server/.cache /opt/highcharts-cache && \
    rm -rf /usr/local/lib/node_modules/highcharts-export-server/.cache && \
    ln -sf /tmp/.cache /usr/local/lib/node_modules/highcharts-export-server/.cache

# ── Front server: built monorepo output + production deps ──
WORKDIR /app
COPY --from=builder /app/package.json /app/pnpm-workspace.yaml /app/pnpm-lock.yaml ./
COPY --from=builder /app/node_modules/ node_modules/
COPY --from=builder /app/packages/ packages/
COPY services/jto-render-server/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

# Non-root user with a writable HOME (LibreOffice profile + highcharts cache).
RUN useradd -m -s /bin/bash appuser && \
    chown -R appuser:appuser /opt/highcharts-cache /usr/src/app /app
USER appuser
ENV HOME=/home/appuser

ENV NODE_ENV=production
ENV HIGHCHARTS_UPSTREAM_URL=http://127.0.0.1:7801
ENV PORT=10000

EXPOSE 10000

CMD ["/usr/local/bin/entrypoint.sh"]
