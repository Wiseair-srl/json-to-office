# @json-to-office/json-to-docx

## 0.16.0

### Minor Changes

- 95cc7c4: feat(docx): `visual` component — embed pptx-rendered graphics as PNGs

  Author a free-canvas graphic as a single pptx slide directly inside a
  `.docx.json` document; it is rasterized to a PNG at build time and embedded as
  an image. Unlocks absolute positioning, overlapping shapes and layered art
  (infographics, diagrams, hero compositions) that the docx flow layout cannot
  express — while the visual stays plain, diffable, deterministic JSON.

  Mirrors the `highcharts` pattern: the component offloads rendering to an
  injected service (`services.pptx`) and desugars to a plain `image`. The
  published engine packages stay pure JS — no binary dependency.

  - New `visual` standard component (`canvas` + pptx `elements`, plus
    image-style placement props: `width`, `alignment`, `caption`, `spacing`,
    `floating`). Allowed inside `section` and `columns`.
  - First-class validation: `elements` are validated against the real PPTX
    slide-content union (`PptxSlideContentSchema`, new in
    `@json-to-office/shared-pptx`) — same authoring fidelity as a standalone
    `.pptx.json`, with full Monaco autocomplete. Hoisted into a single
    `PptxSlideContent` JSON-Schema definition (no per-use inlining).
  - New `services.pptx` config (`PptxServiceConfig`): inject an in-process
    `render` callback or an HTTP `serverUrl`; per-component `dpi`/`serverUrl`
    overrides.
  - `createLibreOfficePptxRasterizer()` (from `@json-to-office/jto-cli`):
    pptx → (LibreOffice) PDF → (poppler `pdftoppm`) PNG, with a content-addressed
    on-disk cache. Wired into the `jto` CLI/server docx path automatically; point
    at a remote rasterizer with `JTO_PPTX_RASTERIZER_URL`.
  - `flattenVisuals(doc, { rasterize, dpi })` (re-exported from
    `@json-to-office/json-to-docx`): desugar every `visual` → `image{base64}`
    ahead of time, producing a portable document that builds with no service
    configured.
  - `POST /api/pptx/rasterize` on the `jto` server: `{ presentation, dpi }` →
    `{ base64DataUri, width, height }`, the HTTP backend for `services.pptx.serverUrl`.
  - `jto-render-server` — a standalone combined server (`packages/jto/dist/render-server.js`)
    that serves `POST /rasterize` and reverse-proxies everything else to a
    co-located Highcharts Export Server, so one Render instance backs both
    `services.highcharts` and `services.pptx`. Deployed via the renamed
    `services/jto-render-server` image (Chromium + LibreOffice + poppler).
  - Example: `examples/visual-infographic.docx.json`.

  Robustness:

  - Visuals render and flatten in every position — section/column children,
    section headers/footers, and table cells/headers — not just top-level
    children. `flattenVisuals` rasterizes with bounded concurrency and skips
    disabled visuals.
  - DPI policy is centralized (`DEFAULT/MIN/MAX_VISUAL_DPI`, range 36–600) and
    enforced everywhere; the public `/rasterize` shares one validated handler
    (body-size limit, rate limit, dpi clamp) with the in-app route.
  - The combined server's `/health` reflects the highcharts upstream's readiness;
    proxy and rasterize fetches have timeouts; the entrypoint supervises (restarts)
    highcharts. The rasterizer cache writes atomically and validates PNGs (no
    truncated/0×0 images), and binary resolution is memoized.

### Patch Changes

- Updated dependencies [95cc7c4]
  - @json-to-office/shared@0.16.0
  - @json-to-office/shared-docx@0.16.0
  - @json-to-office/core-docx@0.16.0

## 0.15.0

### Minor Changes

- ffd5c3d: fix(docx): table rows no longer inherit body-paragraph spacing

  Table cells render as a single wrapper paragraph that previously inherited the
  theme's `normal` style, dragging body-prose rhythm (8–10pt after-spacing +
  1.4–1.5× line) into every row. That inflated row height by ~9pt regardless of
  font size, cell padding, or the cell `height` prop (which is `atLeast`, so it
  can only grow rows). A 5pt-font row still rendered ~22pt tall.

  Table cells (and header cells) now get their own dense paragraph spacing by
  default — no extra before/after spacing, single line. Vertical breathing room
  is the job of cell padding. Measured row pitch for a single-line 11pt row drops
  from ~28.9pt to ~13.7pt.

  Themes can tune table spacing via two new conventional style keys (standard
  `StyleProperties`, no schema change):

  - `styles.tableCell` — paragraph spacing/line for body cells
  - `styles.tableHeader` — paragraph spacing/line for header cells

  ```json
  {
    "styles": {
      "tableCell": {
        "spacing": { "after": 6 },
        "lineSpacing": { "type": "multiple", "value": 1.5 }
      }
    }
  }
  ```

  Note: this changes the rendered height of existing tables (rows become tighter).
  Documents relying on the old roomier rows can restore them per-theme via
  `styles.tableCell` / `styles.tableHeader`.

### Patch Changes

- Updated dependencies [ffd5c3d]
  - @json-to-office/core-docx@0.15.0

## 0.14.0

### Minor Changes

- afe9789: feat(docx): tracked-change document diff

  Diff two docx JSON definitions into a redline rendered as native Word tracked
  changes (accept/reject, author, timestamp; opens in review mode).

  - New `revision` prop on `paragraph`/`heading`/`list` items and a
    `trackRevisions` root prop, rendered as `w:ins`/`w:del`.
  - `diffDocuments(oldDoc, newDoc)` (word-level diff, block alignment, fidelity
    summary), re-exported from `@json-to-office/json-to-docx`.
  - CLI: `jto docx diff <old> <new> -o redline.docx`.
  - Playground: `POST /api/docx/diff` endpoint and a Compare dialog that opens
    the redline as a normal document with live preview.

### Patch Changes

- Updated dependencies [afe9789]
- Updated dependencies [8916aaa]
  - @json-to-office/shared-docx@0.14.0
  - @json-to-office/core-docx@0.14.0

## 0.13.0

### Minor Changes

- 755d812: feat(core-docx): surface `standardDefinition` from `generate` / `generateBuffer` / `generateFile` — the post-expansion JSON tree (custom plugins resolved) is returned alongside the document/buffer at no extra cost. Plugin `render()` previously ran twice when callers used the standalone inspection method together with a generate call, duplicating side effects (e.g. external API hits).

  `getStandardComponentsDefinition` is **deprecated** and now implemented as a thin wrapper around `generate(...).standardDefinition`. Existing callers keep working; migrate by reading `standardDefinition` directly off any `generate*` result. The method will be removed in a future major.

### Patch Changes

- Updated dependencies [8744ad2]
- Updated dependencies [755d812]
  - @json-to-office/shared@0.13.0
  - @json-to-office/core-docx@0.13.0
  - @json-to-office/shared-docx@0.13.0

## 0.12.0

### Patch Changes

- c4a57aa: chore: drop highcharts-export-server peerDependency — server is only called over HTTP, no runtime import; removes install-time approve-build warning for consumers
- Updated dependencies [c4a57aa]
- Updated dependencies [c4a57aa]
  - @json-to-office/core-docx@0.12.0
  - @json-to-office/shared@0.12.0
  - @json-to-office/shared-docx@0.12.0

## 0.9.0

### Patch Changes

- Updated dependencies [58c0fb6]
  - @json-to-office/shared@0.9.0
  - @json-to-office/shared-docx@0.9.0
  - @json-to-office/core-docx@0.9.0

## 0.8.0

### Patch Changes

- Updated dependencies [b1af6ef]
  - @json-to-office/core-docx@0.8.0
  - @json-to-office/shared-docx@0.8.0
  - @json-to-office/shared@0.8.0

## 0.7.0

### Patch Changes

- Updated dependencies [c0bd927]
  - @json-to-office/shared@0.7.0
  - @json-to-office/core-docx@0.7.0
  - @json-to-office/shared-docx@0.7.0

## 0.6.0

### Patch Changes

- Updated dependencies [84299d3]
  - @json-to-office/shared-docx@0.6.0
  - @json-to-office/core-docx@0.6.0

## 0.5.0

### Patch Changes

- Updated dependencies [b34970d]
  - @json-to-office/core-docx@0.5.0

## 0.4.0

### Minor Changes

- f6f9f3f: Re-export core generation and validation functions from public API

## 0.3.0

### Patch Changes

- Updated dependencies [de674e0]
  - @json-to-office/shared-docx@0.3.0
  - @json-to-office/core-docx@0.3.0

## 0.2.0

### Patch Changes

- Updated dependencies [1db99a3]
  - @json-to-office/shared@0.2.0
  - @json-to-office/core-docx@0.2.0
  - @json-to-office/shared-docx@0.2.0
