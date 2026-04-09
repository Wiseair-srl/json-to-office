FROM node:20-bookworm-slim

RUN apt-get update && apt-get install -y \
    chromium \
    fonts-liberation \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

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
      "--no-sandbox",\
      "--no-zygote",\
      "--disable-setuid-sandbox",\
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
    "host": "0.0.0.0",\
    "port": 7801\
  }\
}' > /usr/src/app/config.json

# Cache-warming: downloads Highcharts JS modules. Browser launch fails at build
# time (no sandbox in Docker build), but the module cache is still written.
RUN highcharts-export-server --noLogo 1 --enableServer 0 --loadConfig /usr/src/app/config.json || true

RUN cp -r /usr/local/lib/node_modules/highcharts-export-server/.cache /opt/highcharts-cache && \
    rm -rf /usr/local/lib/node_modules/highcharts-export-server/.cache && \
    ln -sf /tmp/.cache /usr/local/lib/node_modules/highcharts-export-server/.cache

RUN useradd -m -s /bin/bash hcuser && \
    chown -R hcuser:hcuser /opt/highcharts-cache /usr/src/app
USER hcuser

WORKDIR /tmp

EXPOSE 7801

CMD ["sh", "-c", "cp -r /opt/highcharts-cache /tmp/.cache 2>/dev/null || true && exec highcharts-export-server --loadConfig /usr/src/app/config.json"]
