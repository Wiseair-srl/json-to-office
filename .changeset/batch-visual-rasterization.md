---
'@json-to-office/shared': minor
'@json-to-office/core-docx': minor
'@json-to-office/jto-cli': minor
'@json-to-office/jto': minor
---

feat: coalesce per-document visual rasterization into batched calls (#153)

A docx render used to rasterize each `visual` component with its own
`/rasterize` round trip and its own LibreOffice launch — ~25 sequential
calls for the bundled annual-report templates, which starved the render
server's rate limit (#152).

Rendering now runs a per-document pre-pass that collects every enabled
visual, dedupes identical ones, and rasterizes them together. A batch is N
independent single-slide decks converted in ONE soffice launch (the launch
is the amortized cost): each slide keeps its own PDF/PNG, its own size and
dpi — so nothing is grouped and no page↔visual index mapping exists — and
its cache key is identical to the single-slide path, so batch and single
share the disk cache.

- `shared`: `PptxRasterizeBatch*` types, `PptxBatchRasterizer`,
  `PptxServiceConfig.renderBatch`, `MAX_RASTERIZE_BATCH_SLIDES`.
- `jto-cli`: `createLibreOfficePptxBatchRasterizer()`; single and batch
  share one engine with per-slide results, and a slide whose PDF is missing
  after a batch launch is retried once in isolation.
- `core-docx`: `renderDocument` pre-pass seeding a keyed result map;
  `renderVisualComponent` falls back to per-visual rasterization on any
  miss, so old servers (404 on the batch route), transport failures, or
  collection gaps degrade to today's behavior. `flattenVisuals` accepts
  `rasterizeBatch`.
- `jto`: additive `POST /rasterize/batch` on both surfaces (playground +
  render server) with per-slide validation, source policy, and 200-with-
  item-errors semantics; shares middleware and one rate-limit bucket with
  `/rasterize`. Per-slide errors are stage-tagged: slide-content (`build`)
  errors surface verbatim, tooling errors are sanitized to a generic
  message (raw detail goes to the server log). Both routes enforce an
  estimated pixel budget (64MP/slide, 256MP/batch).

Robustness bounds: the engine runs against a wall-clock deadline (one
batch-scaled soffice window + one pdftoppm window), isolated retries for
missing PDFs are capped at 3, and a batch where nothing converted fails
fast instead of retrying per slide.

One document is now ~one request and ~one soffice launch, so public
rasterize rate limits can come back down.
