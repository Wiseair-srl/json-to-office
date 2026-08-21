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

// The service authenticates with an API key of its own (RENDER_API_KEY).
// Send it on every call; add gateway credentials here too if you front it.
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
  - `POST /rasterize/batch` — up to 32 independent slides per request, one LibreOffice launch, per-slide results; shares `/rasterize`'s rate limiter, limits, and auth. This is what lets one document ≈ one request.
  - `POST /export` — the Highcharts Export Server protocol, proxied to the internal upstream after strict validation. Only base64 PNG exports are accepted (`type: "png"`, `b64: true`), unknown top-level fields are rejected, and the effective raster size is capped.

  There is no catch-all proxy: any other path returns `404`, and a wrong method on `/export`, `/rasterize`, or `/rasterize/batch` returns `405`. Upstream `Set-Cookie` headers are stripped from responses.

- A **Highcharts Export Server** (`highcharts-export-server@5.1.0`, Puppeteer + Chromium) runs internally on `127.0.0.1:7801` and is never exposed directly.

The image's `entrypoint.sh` runs Highcharts in a supervisor loop (restart with a 2 s backoff if it exits) and `exec`s the front server in the foreground, so the container's lifecycle tracks the front server while a Highcharts crash self-heals — with `/health` honestly reporting 503 in the meantime.

The Dockerfile builds the whole monorepo in a `node:20-slim` stage, then assembles a `node:20-bookworm-slim` runtime with `chromium`, `libreoffice-core`, `libreoffice-impress`, `poppler-utils`, and the metric-compatible font packages `fonts-liberation2`, `fonts-crosextra-carlito`, and `fonts-crosextra-caladea`, pre-warms the Highcharts module cache at build time, and runs as a non-root user.

Both rasterize endpoints accept an optional `fonts` array of base64 faces, which the rasterizer stages around each `soffice` launch and tears down afterwards. A caller that sends them — the playground does, for any document whose fonts it has already resolved — gets the real typeface in the rendered PNG. Anything not sent falls back to the container's system faces plus the alias rules in `/etc/fonts/local.conf` (copied from `docker/fontconfig-local.conf`); see [Fonts](/guide/fonts) for that mapping.

::: warning Deploy this service before the playground
Both request schemas are `additionalProperties: false`, so a `fonts`-bearing body reaches an **older** render server as a `400`, not as a field it quietly ignores. The batch path retries once without fonts and the per-visual path does the same, so an old server degrades to fontless visuals rather than failing the document — but deploying the render server first avoids the wasted round trip entirely.
:::

### Environment variables (front server)

**Networking**

| Variable                  | Default                 | Description                                                                  |
| ------------------------- | ----------------------- | ---------------------------------------------------------------------------- |
| `PORT`                    | `10000`                 | Public listen port.                                                          |
| `HIGHCHARTS_UPSTREAM_URL` | `http://127.0.0.1:7801` | Internal Highcharts Export Server address (trailing slash stripped).         |
| `PROXY_TIMEOUT_MS`        | `30000`                 | Proxy fetch timeout; `504` on timeout, `502` if the upstream is unreachable. |
| `HEALTH_TIMEOUT_MS`       | `2000`                  | Upstream probe timeout for `GET /health`.                                    |

**Authentication**

| Variable                | Default                                 | Description                                                                                                                                                      |
| ----------------------- | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RENDER_AUTH_MODE`      | `required` (hardened), `auto` otherwise | `required` rejects every unauthenticated call and returns `503` if no key is configured; `auto` enforces only when a key is set; `disabled` turns the check off. |
| `RENDER_API_KEY`        | — (falls back to `API_KEY`)             | Expected key. Compared with a timing-safe digest comparison.                                                                                                     |
| `RENDER_API_KEY_HEADER` | `x-api-key`                             | Header carrying the key. `Authorization: Bearer <key>` is also accepted.                                                                                         |

**Outbound source policy**

| Variable                  | Default                                    | Description                                                                                                                                                                                                                                               |
| ------------------------- | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `OUTBOUND_SOURCE_MODE`    | `safe` (hardened), `development` otherwise | In `safe` mode every remote asset must be HTTPS on an allowlisted host; local paths, private/loopback addresses, credentialed URLs, active SVG, and renderer JavaScript are rejected. `development` skips these checks so local playgrounds keep working. |
| `OUTBOUND_HOST_ALLOWLIST` | empty                                      | Comma-separated hosts permitted in `safe` mode. `*.example.com` wildcards are supported. **Empty means every remote host is refused.**                                                                                                                    |

**Limits**

| Variable                      | Default                           | Description                                                                                                                                                                               |
| ----------------------------- | --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `EXPORT_RATE_LIMIT`           | `60` (hardened), `1000` otherwise | `POST /export` requests per window.                                                                                                                                                       |
| `RASTERIZE_RATE_LIMIT`        | `30` (hardened), `1000` otherwise | `POST /rasterize` requests per window.                                                                                                                                                    |
| `RENDER_RATE_LIMIT_WINDOW_MS` | `900000`                          | Rate-limit window (15 minutes).                                                                                                                                                           |
| `MAX_CONCURRENT_RENDERS`      | `4` (hardened), `16` otherwise    | In-flight renders before `503 Server is at capacity`.                                                                                                                                     |
| `MAX_EXPORT_BODY_SIZE`        | `4194304`                         | Max `/export` request body (4 MiB).                                                                                                                                                       |
| `MAX_RASTERIZE_BODY_SIZE`     | `33554432`                        | Max `/rasterize` request body (32 MiB).                                                                                                                                                   |
| `MAX_RENDER_RESPONSE_SIZE`    | `25165824`                        | Max upstream response read (24 MiB).                                                                                                                                                      |
| `TRUST_PROXY_HEADERS`         | `false`                           | Derive the rate-limit client key from `X-Real-IP` / `X-Forwarded-For`. Enable **only** behind a proxy that overwrites them — otherwise callers can spoof their identity and evade limits. |

::: tip `NODE_ENV` selects the hardened defaults
Any value other than `development` or `test` — including `production`, `staging`, or a typo — selects the hardened column above. A mislabelled deployment fails safe rather than silently running with permissive defaults.
:::

::: warning Authentication is on by default, but the key is yours to set
With `RENDER_AUTH_MODE=required` and no `RENDER_API_KEY`, the service answers `503` to every request — it fails closed rather than open. Set a strong key and send it from every client.

The outbound-source policy blocks SSRF and local-file reads, but it is not a substitute for network isolation. Rendering is expensive and Chromium-backed, so still prefer to keep the service on a private network or behind your own gateway, reachable only by your playground or backend.
:::

### Running it locally

The compose file builds from the repo root (the Dockerfile compiles the monorepo):

```bash
docker compose -f services/jto-render-server/docker-compose.yml up --build
```

It publishes port `10000` on loopback only (`127.0.0.1:10000`) with a `/health` healthcheck, and runs with `RENDER_AUTH_MODE=required`. The compose file defaults `RENDER_API_KEY` to `local-render-key`; override it in your environment and send the same value from clients.

## The /rasterize protocol

`POST /rasterize` takes a full pptx document JSON (usually a single slide) plus an optional DPI, and returns a PNG as a data URI:

```json
POST /rasterize
Content-Type: application/json

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
- The presentation is checked against the [outbound source policy](#environment-variables-front-server) before rendering, so local file paths and non-allowlisted hosts fail with `400` rather than being fetched.
- Errors: missing binaries map to `503`, invalid presentations to `400`, everything else to `500`.

### POST /rasterize/batch

One document usually carries many visuals, so the batch endpoint rasterizes up to **32 independent slides per request** — one LibreOffice launch instead of one per visual. Each slide is a complete single-slide presentation with its own optional `dpi` (slides are never merged, so sizes and themes may differ freely):

```json
POST /rasterize/batch
Content-Type: application/json

{
  "slides": [
    { "presentation": { "name": "pptx", "...": "..." }, "dpi": 120 },
    { "presentation": { "name": "pptx", "...": "..." } }
  ]
}
```

```json
200 OK
{
  "results": [
    { "ok": true, "base64DataUri": "data:image/png;base64,...", "width": 480, "height": 240 },
    { "ok": false, "error": "Top-level component must be a pptx component", "stage": "build" }
  ]
}
```

`results` is index-aligned with `slides`. A bad slide fails **per item** (`ok: false`) without discarding its siblings: errors caused by the slide's own JSON (`stage: "build"`) are returned verbatim, while internal tooling failures (`stage: "convert"` or `"rasterize"`) come back as a generic `Slide rasterization failed` (full detail goes to the server log). Batch-level problems (validation, missing binaries) use the same `400`/`503` mapping as `/rasterize`. Both routes share one rate-limit bucket, body limit, auth, and source policy, enforce an estimated pixel budget (64 MP per slide, 256 MP per batch), and key the PNG cache per slide — identically to `/rasterize` — so mixing the two endpoints never re-renders unchanged visuals.

DOCX generation uses this automatically: the renderer collects a document's visuals up front, sends them as batches, and **falls back to per-visual `/rasterize` calls if the batch endpoint is unavailable** (e.g. an older render server), so clients and servers can upgrade independently.

## Deploying the playgrounds

The repo's root `Dockerfile` builds the [playground](/guide/playground) as a Docker image. The key insight: **the deployed playground is the dev server** — the container simply runs the CLI's `dev` command:

```dockerfile
# runtime env: NODE_ENV=production, AI_ENABLED=false, HOST=0.0.0.0, FORMAT=docx
CMD node packages/jto/dist/cli.js ${FORMAT} dev --host 0.0.0.0 --port 10000
```

One image serves both formats: set `FORMAT=docx` or `FORMAT=pptx` per container. The runtime stage includes `libreoffice-core`, `libreoffice-writer`, and `libreoffice-impress` for the high-fidelity PDF previews, and the build arg `VITE_AI_ENABLED=false` compiles the client with the AI assistant hidden. It also installs `fonts-liberation2`, `fonts-crosextra-carlito`, and `fonts-crosextra-caladea` and copies `docker/fontconfig-local.conf` to `/etc/fonts/local.conf`: because the apt line passes `--no-install-recommends`, LibreOffice's own font recommendation is suppressed and the packages have to be named explicitly — without them every font collapses to DejaVu and previews break lines in the wrong places.

The `render.yaml` Render.com blueprint declares the full production topology — three Docker web services, all health-checked on `/health`:

| Service               | Dockerfile                              | Env                                                                                                                                                                                             |
| --------------------- | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `jto-render-server`   | `services/jto-render-server/Dockerfile` | `RENDER_AUTH_MODE=required`, `RENDER_API_KEY` (secret, not committed)                                                                                                                           |
| `jto-playground-docx` | root `Dockerfile`                       | `FORMAT=docx`, `VITE_AI_ENABLED=false`, `AI_ENABLED=false`, `API_AUTH_MODE=disabled`, `HIGHCHARTS_SERVER_URL` + `HIGHCHARTS_API_KEY`, `JTO_PPTX_RASTERIZER_URL` + `JTO_PPTX_RASTERIZER_API_KEY` |
| `jto-playground-pptx` | root `Dockerfile`                       | Same, with `FORMAT=pptx`                                                                                                                                                                        |

Both playgrounds point their render URLs at `https://jto-render-server.onrender.com` and authenticate with the render server's `RENDER_API_KEY`; the two caller-side key variables carry that same value.

The playgrounds themselves run with `API_AUTH_MODE=disabled` because they are deliberately public browser demos — a browser cannot keep an API key secret. Both also set `AI_ENABLED=false`: `VITE_AI_ENABLED` only hides the client UI, while `AI_ENABLED` is what stops the server mounting `/api/ai`. For a private deployment, drop the `disabled` override, use `API_AUTH_MODE=required`, and put the key behind an authenticated gateway.

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

| Variable                                           | Effect                                                                          |
| -------------------------------------------------- | ------------------------------------------------------------------------------- |
| Variable                                           | Effect                                                                          |
| -------------------------------------------------- | ------------------------------------------------------------------------------- |
| `HIGHCHARTS_SERVER_URL`                            | Sets `services.highcharts.serverUrl` for `highcharts` components.               |
| `HIGHCHARTS_API_KEY` / `HIGHCHARTS_API_KEY_HEADER` | Adds an auth header to chart export requests (header defaults to `x-api-key`).  |
| `JTO_PPTX_RASTERIZER_URL`                          | DOCX generation uses this remote `/rasterize` server for `visual` components.   |
| `LIBREOFFICE_PATH` / `PDFTOPPM_PATH`               | Override binary paths for the in-process rasterizer.                            |

Without `HIGHCHARTS_SERVER_URL`, chart components fall back to `http://localhost:7801` (start one with `pnpm dlx highcharts-export-server --enableServer true`). Without a configured rasterizer URL, the default remote endpoint is `http://localhost:7802` — but the CLI does not need it, as described next.

There is no rasterizer-specific API-key variable: `services.pptx` accepts `headers` programmatically, but the CLI only wires a URL from the environment. Point both callers at the render server like this:

```bash
export HIGHCHARTS_SERVER_URL=https://render.example.com
export JTO_PPTX_RASTERIZER_URL=https://render.example.com
```

### In-process LibreOffice fallback

When `JTO_PPTX_RASTERIZER_URL` is **not** set, the DOCX CLI wires `services.pptx.render` and `services.pptx.renderBatch` to in-process rasterizers (`createLibreOfficePptxRasterizer` / `createLibreOfficePptxBatchRasterizer`, both exported from `@json-to-office/jto-cli`). A document's visuals are collected up front and batch-rasterized — one `soffice` launch converts every cache-missing slide, each as its own single-slide deck. The per-slide pipeline:

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
