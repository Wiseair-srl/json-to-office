# Render server & deployment

Two component families need real rendering machinery at generation time: `highcharts` charts (a Chromium-based export server) and the DOCX `visual` component (LibreOffice + poppler to rasterize a slide into a PNG). This page explains how those services are injected, how to deploy the combined `jto-render-server`, and how to wire clients to it.

## The service-injection design

The published generation packages never depend on binaries. Instead, they depend on one small interface, `ServicesConfig`, and callers inject concrete implementations:

```ts
interface ServicesConfig {
  highcharts?: {
    serverUrl?: string;
    headers?: Record<string, string> | HighchartsHeadersResolver;
  };
  pptx?: {
    render?: PptxRasterizer; // in-process callback — takes precedence
    serverUrl?: string; // ...over a remote /rasterize server
    headers?: Record<string, string>;
    dpi?: number; // default 200, clamped to [36, 600]
  };
}
```

This keeps `@json-to-office/json-to-docx` and `@json-to-office/json-to-pptx` installable anywhere — a serverless function, a browser bundle, a CI runner — with Chromium, LibreOffice, and poppler living behind whichever service you point them at. Documents that use neither `highcharts` nor `visual` need no services at all.

Programmatically, services are passed as a generation option:

```ts
import { generateBufferFromJson } from '@json-to-office/json-to-docx';

const renderHeaders = { 'x-api-key': process.env.RENDER_API_KEY! };
const buffer = await generateBufferFromJson(document, {
  services: {
    highcharts: {
      serverUrl: 'https://render.example.com',
      headers: renderHeaders,
    },
    pptx: {
      serverUrl: 'https://render.example.com',
      headers: renderHeaders,
    },
  },
});
```

See the [API reference](/reference/api) for the full options object and the [charts guide](/guide/charts) for the chart-side details.

## jto-render-server

`services/jto-render-server` in the repo ([GitHub](https://github.com/Wiseair-srl/json-to-office)) packages both rendering backends into **one Docker image with one public port**:

- A Node **front server** (`packages/jto/dist/render-server.js`) owns the public port (`PORT`, default `10000`) and exposes:
  - `GET /health` — probes the internal Highcharts server (2 s timeout). Returns `ok` on success, otherwise `503 { status: 'degraded', ... }`. Reporting 503 while Highcharts is down keeps a load balancer from routing `/export` traffic to a half-up instance.
  - `POST /rasterize` — the pptx-slide-to-PNG endpoint (rate-limited to 30 requests / 15 min in production).
  - **Everything else** — reverse-proxied to the Highcharts upstream. In practice that means `POST /export`, the Highcharts Export Server protocol.
- A **Highcharts Export Server** (`highcharts-export-server@5.1.0`, Puppeteer + Chromium) runs internally on `127.0.0.1:7801` and is never exposed directly.

The image's `entrypoint.sh` runs Highcharts in a supervisor loop (restart with a 2 s backoff if it exits) and `exec`s the front server in the foreground, so the container's lifecycle tracks the front server while a Highcharts crash self-heals — with `/health` honestly reporting 503 in the meantime.

The Dockerfile builds the whole monorepo in a `node:20-slim` stage, then assembles a `node:20-bookworm-slim` runtime with `chromium`, `libreoffice-core`, `libreoffice-impress`, and `poppler-utils`, pre-warms the Highcharts module cache at build time, and runs as a non-root user.

### Environment variables (front server)

| Variable                                     | Default                                       | Description                                                                                                             |
| -------------------------------------------- | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `PORT`                                       | `10000`                                       | Public listen port.                                                                                                     |
| `HIGHCHARTS_UPSTREAM_URL`                    | `http://127.0.0.1:7801`                       | Internal Highcharts Export Server address (trailing slash stripped).                                                    |
| `PROXY_TIMEOUT_MS`                           | `30000`                                       | Proxy fetch timeout; `504` on timeout, `502` if the upstream is unreachable.                                            |
| `RENDER_AUTH_MODE`                           | `required` in production, `auto` otherwise    | `required` always checks credentials, `auto` checks only when a key exists, `disabled` is an explicit opt-out.          |
| `RENDER_API_KEY`                             | —                                             | Secret required by `/export` and `/rasterize` when auth is required. `API_KEY` is accepted as a compatibility fallback. |
| `RENDER_API_KEY_HEADER`                      | `x-api-key`                                   | Credential header name. Bearer authorization is also accepted.                                                          |
| `MAX_EXPORT_BODY_SIZE`                       | `4194304`                                     | Maximum `/export` JSON body in bytes.                                                                                   |
| `MAX_RASTERIZE_BODY_SIZE`                    | `33554432`                                    | Maximum `/rasterize` JSON body in bytes.                                                                                |
| `MAX_RENDER_RESPONSE_SIZE`                   | `25165824`                                    | Maximum buffered Highcharts response in bytes.                                                                          |
| `MAX_CONCURRENT_RENDERS`                     | `4` in production, `16` otherwise             | Shared concurrency cap across both render routes.                                                                       |
| `EXPORT_RATE_LIMIT` / `RASTERIZE_RATE_LIMIT` | `60` / `30` in production                     | Requests allowed per render-rate window.                                                                                |
| `RENDER_RATE_LIMIT_WINDOW_MS`                | `900000`                                      | Rate-limit window in milliseconds.                                                                                      |
| `OUTBOUND_SOURCE_MODE`                       | `safe` in production, `development` otherwise | `safe` rejects local paths, private-network URLs, and hosts outside the allowlist.                                      |
| `OUTBOUND_HOST_ALLOWLIST`                    | —                                             | Comma-separated external asset hosts allowed in safe mode.                                                              |
| `TRUST_PROXY_HEADERS`                        | `false`                                       | Trust forwarded client-IP headers for rate limiting only behind a trusted proxy.                                        |
| `NODE_ENV`                                   | —                                             | `production` enables required auth, safe outbound-source policy, and tighter limits by default.                         |

`GET /health` remains unauthenticated for load balancers. In production, omitting `RENDER_API_KEY` while auth is required makes render requests fail closed with `503 AUTH_CONFIGURATION_ERROR`; it never silently creates a public renderer.

### Running it locally

The compose file builds from the repo root (the Dockerfile compiles the monorepo):

```bash
RENDER_API_KEY=replace-with-a-random-secret \
  docker compose -f services/jto-render-server/docker-compose.yml up --build
# bound to http://127.0.0.1:10000 with a /health healthcheck
```

The compose default key (`local-render-key`) is only a local convenience and the port is loopback-bound. Set `RENDER_API_KEY` explicitly for shared development hosts.

## The /rasterize protocol

`POST /rasterize` takes a full pptx document JSON (usually a single slide) plus an optional DPI, and returns a PNG as a data URI:

```json
POST /rasterize
Content-Type: application/json
x-api-key: <RENDER_API_KEY>

{
  "presentation": {
    "name": "pptx",
    "props": { "slideWidth": 4, "slideHeight": 2 },
    "children": [
      {
        "name": "slide",
        "props": { "background": { "color": "EEEEEE" } },
        "children": [
          { "name": "text", "props": { "text": "hi", "x": 0.5, "y": 0.7, "w": 3, "h": 0.6 } }
        ]
      }
    ]
  },
  "dpi": 120
}
```

```json
200 OK
{ "base64DataUri": "data:image/png;base64,...", "width": 480, "height": 240 }
```

Contract details, enforced by a handler shared between the render server and the playground API (so limits and error mapping cannot drift):

- Body must be `application/json` (else `400`) and at most **32 MB** (else `413`).
- Schema: `presentation` (object, required) and optional `dpi`, which must be a number in `[36, 600]`; unknown fields are rejected. Omitting `dpi` uses the default of `200`.
- Errors: missing binaries map to `503`, invalid presentations to `400`, everything else to `500`.

## Deploying the playgrounds

The repo's root `Dockerfile` builds the [playground](/guide/playground) as a Docker image. The key insight: **the deployed playground is the dev server** — the container simply runs the CLI's `dev` command:

```dockerfile
# runtime env: NODE_ENV=production, AI_ENABLED=false, HOST=0.0.0.0, FORMAT=docx
CMD node packages/jto/dist/cli.js ${FORMAT} dev --host 0.0.0.0 --port 10000
```

One image serves both formats: set `FORMAT=docx` or `FORMAT=pptx` per container. The runtime stage includes `libreoffice-core`, `libreoffice-writer`, and `libreoffice-impress` for the high-fidelity PDF previews, and the build arg `VITE_AI_ENABLED=false` compiles the client with the AI assistant hidden.

The `render.yaml` Render.com blueprint declares the full production topology — three Docker web services, all health-checked on `/health`:

| Service               | Dockerfile                              | Env                                                                                                                        |
| --------------------- | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `jto-render-server`   | `services/jto-render-server/Dockerfile` | `RENDER_AUTH_MODE=required`, secret `RENDER_API_KEY`                                                                       |
| `jto-playground-docx` | root `Dockerfile`                       | `FORMAT=docx`, `VITE_AI_ENABLED=false`, render URLs, and the matching `HIGHCHARTS_API_KEY` / `JTO_PPTX_RASTERIZER_API_KEY` |
| `jto-playground-pptx` | root `Dockerfile`                       | Same, with `FORMAT=pptx`                                                                                                   |

In `render.yaml`, every `sync: false` render credential must be set to the **same secret value** in the Render dashboard. The hosted playground services explicitly set `API_AUTH_MODE=disabled` because they are public browser demos and a browser-delivered API key would not be secret. For a private deployment, keep the production default (`required`), set `API_KEY`, restrict `CORS_ORIGIN`, and place the UI/API behind your identity-aware gateway.

```text
.docx.json / .pptx.json
   │  generate (CLI / API / playground)
   ▼
core-docx / core-pptx ──(services.highcharts.serverUrl)──▶ POST {url}/export ──▶ Highcharts (Chromium)
core-docx `visual`    ──(services.pptx.render | serverUrl)─▶ in-process LibreOffice rasterizer
                                                            or POST {url}/rasterize ──▶ jto-render-server
```

## Wiring clients

### CLI and dev server (environment variables)

Both CLIs build a `ServicesConfig` from the environment:

| Variable                                                             | Effect                                                                                                       |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `HIGHCHARTS_SERVER_URL`                                              | Sets `services.highcharts.serverUrl` for `highcharts` components.                                            |
| `HIGHCHARTS_API_KEY` / `HIGHCHARTS_API_KEY_HEADER`                   | Adds an auth header (header name defaults to `x-api-key`).                                                   |
| `JTO_PPTX_RASTERIZER_URL`                                            | DOCX generation uses this remote `/rasterize` server for `visual` components.                                |
| `JTO_PPTX_RASTERIZER_API_KEY` / `JTO_PPTX_RASTERIZER_API_KEY_HEADER` | Adds rasterizer auth (header defaults to `x-api-key`). Falls back to the Highcharts key/header when omitted. |
| `LIBREOFFICE_PATH` / `PDFTOPPM_PATH`                                 | Override binary paths for the in-process rasterizer.                                                         |

Without `HIGHCHARTS_SERVER_URL`, chart components fall back to `http://localhost:7801` (start one with `pnpm dlx highcharts-export-server --enableServer true`). Without a configured rasterizer URL, the default remote endpoint is `http://localhost:7802` — but the CLI does not need it, as described next.

For the combined authenticated server, configure both callers explicitly:

```bash
export HIGHCHARTS_SERVER_URL=https://render.example.com
export HIGHCHARTS_API_KEY="$RENDER_API_KEY"
export JTO_PPTX_RASTERIZER_URL=https://render.example.com
export JTO_PPTX_RASTERIZER_API_KEY="$RENDER_API_KEY"
```

### In-process LibreOffice fallback

When `JTO_PPTX_RASTERIZER_URL` is **not** set, the DOCX CLI wires `services.pptx.render` to an in-process rasterizer (`createLibreOfficePptxRasterizer`, also exported from `@json-to-office/jto-cli`). Its pipeline:

1. Render the visual's slide JSON to a `.pptx` with core-pptx.
2. `soffice --headless --convert-to pdf` with an isolated user profile (60 s timeout).
3. `pdftoppm -r <dpi> -png` (30 s timeout) to get the PNG.

Binary discovery tries `LIBREOFFICE_PATH`, then platform defaults (e.g. `/Applications/LibreOffice.app/Contents/MacOS/soffice` on macOS), then `soffice`/`libreoffice` on `PATH`; `pdftoppm` respects `PDFTOPPM_PATH`. Results go into a **content-addressed disk cache** (SHA-256 of the presentation JSON + DPI, default directory `<tmpdir>/jto-visual-cache`, atomic writes), so rebuilding a document with unchanged visuals skips the multi-second LibreOffice run entirely. Constructing the rasterizer is cheap — LibreOffice is only spawned if a document actually contains a `visual`.

::: tip An in-process `render` always wins over `serverUrl`
If you provide both, the callback is used. This lets a host with LibreOffice installed stay self-contained while other environments delegate to `jto-render-server`.
:::

### Service-free portable documents: flattenVisuals

If your production host can run neither LibreOffice nor reach a rasterizer, pre-render the visuals wherever you _can_ run them:

```ts
import {
  flattenVisuals,
  generateBufferFromJson,
} from '@json-to-office/json-to-docx';
import { createLibreOfficePptxRasterizer } from '@json-to-office/jto-cli';

// On a machine with LibreOffice + poppler:
const portable = await flattenVisuals(document, {
  rasterize: createLibreOfficePptxRasterizer(),
  dpi: 200, // default
  concurrency: 4, // default
});

// `portable` has every `visual` desugared to a base64 `image` —
// buildable anywhere, no services required:
const buffer = await generateBufferFromJson(portable);
```

`flattenVisuals` walks every child-bearing position (document children, section headers and footers, table cells) and shares its desugaring code with the live render path, so the two can never drift.

::: info
The Highcharts protocol itself (`POST {serverUrl}/export` with `{ infile, type: 'png', b64: true, ... }`) and chart component props are documented in [Charts](/guide/charts) and the [PPTX charts reference](/reference/pptx/charts).
:::
