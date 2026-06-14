#!/bin/sh
# Keep the Highcharts Export Server alive on internal :7801 (restart it if it
# exits), then hand the public port to the Node front server (which proxies
# /export to it and serves /rasterize itself). The front server runs in the
# foreground so the container's lifecycle tracks it — if it dies, Render restarts
# the instance. A highcharts crash is recovered by the supervisor loop; while
# it's down the front server's /health reports 503 so Render won't route /export
# traffic to a half-up instance.
set -e

# Warm the highcharts module cache into a writable location.
cp -r /opt/highcharts-cache /tmp/.cache 2>/dev/null || true

(
  while true; do
    highcharts-export-server --loadConfig /usr/src/app/config.json || true
    echo "[entrypoint] highcharts-export-server exited; restarting in 2s" >&2
    sleep 2
  done
) &

echo "[entrypoint] highcharts supervisor started; starting front server"
exec node packages/jto/dist/render-server.js
