#!/bin/sh
# Start the Highcharts Export Server internally on :7801, then hand the public
# port to the Node front server (which proxies /export to it and serves
# /rasterize itself). The front server runs in the foreground so the container's
# lifecycle tracks it — if it dies, Render restarts the instance.
set -e

# Warm the highcharts module cache into a writable location.
cp -r /opt/highcharts-cache /tmp/.cache 2>/dev/null || true

highcharts-export-server --loadConfig /usr/src/app/config.json &
echo "[entrypoint] highcharts-export-server started on 127.0.0.1:7801"

exec node packages/jto/dist/render-server.js
