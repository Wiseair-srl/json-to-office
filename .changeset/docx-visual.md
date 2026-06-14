---
'@json-to-office/shared': minor
'@json-to-office/shared-docx': minor
'@json-to-office/core-docx': minor
'@json-to-office/json-to-docx': minor
'@json-to-office/jto-cli': minor
'@json-to-office/jto': minor
---

feat(docx): `visual` component — embed pptx-rendered graphics as PNGs

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
- Example: `examples/visual-infographic.docx.json`.
