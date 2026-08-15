# @json-to-office/jto

## 0.21.0

### Minor Changes

- 3e05df7: Make generation strict and deterministic by default, harden HTTP rendering,
  ship real schema exports, and migrate CLI output to Ink.

  Behaviour changes to expect when upgrading:

  - **The root component now requires a `props` key.** This aligns the runtime
    validator with the exported JSON Schema, which already marked `props` as
    required. Every field inside it stays optional, so documents that omitted it
    only need `"props": {}`.
  - **Custom component subtrees are now validated.** Standard components authored
    inside a plugin container must satisfy the same prop and tree contract they
    do elsewhere; previously the whole subtree was skipped.
  - **CLI errors go to stderr, and non-TTY output is plain.** Piped or redirected
    output no longer carries terminal escape sequences and is no longer wrapped
    to the terminal width. Use `-f json` for machine-readable results.
  - **Render server:** `resources.files` is rejected in safe mode (Highcharts
    loads it as JavaScript), export dimensions declared under `infile.exporting`
    are now capped, and any `NODE_ENV` other than `development` / `test` gets
    production-grade auth, rate-limit, and outbound-source defaults.

### Patch Changes

- Updated dependencies [3e05df7]
  - @json-to-office/core-docx@0.21.0
  - @json-to-office/core-pptx@0.21.0
  - @json-to-office/jto-cli@0.21.0
  - @json-to-office/shared-docx@0.21.0
  - @json-to-office/shared-pptx@0.21.0
  - @json-to-office/shared@0.21.0

## 0.20.0

### Patch Changes

- Updated dependencies [bc15ebf]
- Updated dependencies [bc15ebf]
- Updated dependencies [de4d21c]
  - @json-to-office/core-pptx@0.20.0
  - @json-to-office/core-docx@0.20.0
  - @json-to-office/shared-pptx@0.20.0
  - @json-to-office/jto-cli@0.20.0
  - @json-to-office/shared-docx@0.20.0

## 0.19.0

### Patch Changes

- Updated dependencies [a332658]
  - @json-to-office/shared-docx@0.19.0
  - @json-to-office/shared-pptx@0.19.0
  - @json-to-office/core-docx@0.19.0
  - @json-to-office/core-pptx@0.19.0
  - @json-to-office/jto-cli@0.19.0

## 0.18.0

### Patch Changes

- Updated dependencies [a079015]
- Updated dependencies [71faefc]
  - @json-to-office/core-docx@0.18.0
  - @json-to-office/shared-docx@0.18.0
  - @json-to-office/core-pptx@0.18.0
  - @json-to-office/shared-pptx@0.18.0
  - @json-to-office/jto-cli@0.18.0

## 0.17.2

### Patch Changes

- f379ba0: fix(playground): expand collapsed long-string sentinels before preview/build

  The long-string collapser rewrites the Monaco model text, replacing a value's hidden middle with a `§jtoc:<id>§` sentinel that only `toStorageValue()` restores. The save path called it, but the Run/preview path (`preview:flushAndBuild`) read `editor.getValue()` raw at three points, leaking sentinels into the rendered document (and persisting them back into the store).

  The per-editor `toStorageValue` reconstructor is now exposed on the editor refs store and applied to every live-text read feeding `saveDocument`, `updateTheme`, and `buildDocument`.

  Copy and cut were leaking the sentinel too — the hidden `§jtoc:<id>§` is real model text, so a selection crossing a collapsed chip put the sentinel on the clipboard. `copy`/`cut` are now intercepted in the capture phase and the clipboard is rewritten with the reconstructed value (cut also deletes the selection).

## 0.17.0

### Minor Changes

- 743ee97: feat(playground): collapse very long JSON strings into clickable chips

  Long string values (base64 images, embedded SVGs, big data blobs) wrap into hundreds of rows with wordWrap on, making the editor unusable. The JSON editor now collapses the middle of any value over 200 chars into a hidden sentinel rendered as a clickable chip, keeping a visible head and tail (e.g. `"data:image/png;base64,iVBOR …⟨12.4 KB⟩… AAAA"`). Clicking the chip toggles expand/collapse.

  - In-place, same-line collapse keeps every other line number valid (validation markers, folding, minimap unaffected).
  - Lossless saves: the full document text is reconstructed before persisting; build/preview/export always see the real value.
  - Controlled-value save echoes are ignored so chips and the cursor never thrash while editing.
  - Escape-safe head/tail slicing so non-base64 strings never get cut mid-escape.
  - Validation markers that fall inside a collapsed chip are filtered out.

### Patch Changes

- Updated dependencies [542f8ad]
  - @json-to-office/shared-docx@0.17.0
  - @json-to-office/core-docx@0.17.0
  - @json-to-office/jto-cli@0.17.0

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
  - @json-to-office/jto-cli@0.16.0
  - @json-to-office/core-pptx@0.16.0
  - @json-to-office/shared-pptx@0.16.0

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
  - @json-to-office/jto-cli@0.15.0

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
  - @json-to-office/jto-cli@0.14.0

## 0.13.0

### Patch Changes

- Updated dependencies [8744ad2]
- Updated dependencies [755d812]
  - @json-to-office/shared@0.13.0
  - @json-to-office/core-docx@0.13.0
  - @json-to-office/core-pptx@0.13.0
  - @json-to-office/jto-cli@0.13.0
  - @json-to-office/shared-docx@0.13.0
  - @json-to-office/shared-pptx@0.13.0

## 0.12.0

### Patch Changes

- Updated dependencies [c4a57aa]
- Updated dependencies [c4a57aa]
  - @json-to-office/core-docx@0.12.0
  - @json-to-office/shared@0.12.0
  - @json-to-office/core-pptx@0.12.0
  - @json-to-office/jto-cli@0.12.0
  - @json-to-office/shared-docx@0.12.0
  - @json-to-office/shared-pptx@0.12.0

## 0.11.2

### Patch Changes

- 77e3085: Add Alternative deck and Brand template pptx samples; show template title/description on a second line in the playground document picker; allow select trigger to wrap long values.

## 0.11.0

### Minor Changes

- 7f9679b: Introduce `@json-to-office/jto-cli`, a lightweight CLI package containing only the non-playground commands (`generate`, `validate`, `schemas`, `discover`, `init`, `fonts`). Install it instead of `@json-to-office/jto` in CI or scripting contexts to skip the React/Monaco/Vite/AI-SDK playground deps.

  `@json-to-office/jto` is unchanged for users — it now depends on `jto-cli` and adds the `dev` playground command on top, so `jto docx dev` / `jto pptx dev` still work as before.

  Note: the binary in `@json-to-office/jto-cli` is `jto-cli`, not `jto` — update CI scripts that previously invoked `jto` accordingly.

### Patch Changes

- Updated dependencies [7f9679b]
  - @json-to-office/jto-cli@0.11.0

## 0.9.0

### Minor Changes

- 58c0fb6: Font system across the stack.

  - **shared**: font catalog, registry, and resolver with Google / URL / file / data / variable sources; font validation; substitution tables.
  - **core-docx / core-pptx**: new `fonts` generator option with `custom` (default, keeps references as-is) and `substitute` (rewrites non-safe families to safe equivalents) export modes. Optional `strict` flag throws on unresolved non-safe references. Font-weight synthesis via `fontFace` / `bold` / `fontWeight` aliasing.
  - **shared-docx / shared-pptx**: new optional font fields on text / shape / table / theme schemas (backward compatible).
  - **jto CLI**: `--font`, `--fonts-dir` flags and a `fonts` subcommand.
  - **jto server**: `/api/fonts` catalog, auto-Google resolution, per-platform font staging (macOS / Windows / fontconfig) for LibreOffice preview.
  - **jto client**: font picker dialog (Safe / Google / Uploads), Monaco CodeLens for font fields, live `@font-face` injection in the playground preview.

### Patch Changes

- Updated dependencies [58c0fb6]
  - @json-to-office/shared@0.9.0
  - @json-to-office/shared-docx@0.9.0
  - @json-to-office/shared-pptx@0.9.0
  - @json-to-office/core-docx@0.9.0
  - @json-to-office/core-pptx@0.9.0

## 0.8.3

### Patch Changes

- 6e45a99: fix: sanitize theme key to prevent prototype pollution and guard against undefined themes

## 0.8.2

### Patch Changes

- a5e4e91: Fix Windows build: replace shell-escaped inline Node scripts with cross-platform path.join

## 0.8.1

### Patch Changes

- 2224cfd: Auto-wrap raw document JSON body and include paths in validation errors; replace shell cp with cross-platform Node.js equivalents

## 0.8.0

### Patch Changes

- Updated dependencies [b1af6ef]
  - @json-to-office/core-docx@0.8.0
  - @json-to-office/shared-docx@0.8.0
  - @json-to-office/core-pptx@0.8.0
  - @json-to-office/shared-pptx@0.8.0
  - @json-to-office/shared@0.8.0

## 0.7.0

### Minor Changes

- c0bd927: Add generator-level services config for Highcharts export server endpoint and auth headers

### Patch Changes

- Updated dependencies [c0bd927]
  - @json-to-office/shared@0.7.0
  - @json-to-office/core-docx@0.7.0
  - @json-to-office/core-pptx@0.7.0
  - @json-to-office/shared-docx@0.7.0
  - @json-to-office/shared-pptx@0.7.0

## 0.6.0

### Patch Changes

- 84299d3: Remove placeholder header/footer component types and exports. Centralize image type detection and ImageRun construction. Support percentage strings (e.g., "50%") for floating position offsets and wrap margins, resolved against page or available dimensions. Fix table cell backgroundColor defaulting to transparent when unset.
- Updated dependencies [84299d3]
  - @json-to-office/shared-docx@0.6.0
  - @json-to-office/core-docx@0.6.0

## 0.5.3

### Patch Changes

- a89a7cc: feat: use Monaco built-in JSON schema validation for theme editor

  Replace custom `validateThemeJson` marker-setting with Monaco's native `onValidate`, add ValidationPanel/StatusBar UI, and tighten theme schemas with `additionalProperties: false`.

- Updated dependencies [a89a7cc]
  - @json-to-office/shared-docx@0.5.3

## 0.5.2

### Patch Changes

- 662bef5: feat: default to LibreOffice renderer in both docx and pptx playgrounds, add fidelity warning for docxjs

## 0.5.1

### Patch Changes

- 7ae10c1: Improve sidebar collapsed state UX: faster expand/collapse animation (300ms simultaneous vs 450ms sequential), wider collapsed rail (48px), 2-char doc badges, distinguishable theme badges, tooltip on add buttons, and accessibility attributes.

## 0.5.0

### Minor Changes

- bcd6237: feat(jto): add AI feature flag (AI_ENABLED / VITE_AI_ENABLED env vars), fix prod static serving, respect NODE_ENV for config mode, add Render blueprint for DOCX + PPTX deployment
- b34970d: feat: upgrade JSON template examples to Wiseair-level quality

  - Rewrite proposal (apex theme), technical-guide (devportal theme), invoice (modern table styling)
  - Replace Charts Demo with Lumina Analytics deck (39K, 15 slides, all native chart types, grid + templates + decorative shapes)
  - Rewrite pitch-deck as Meridian Series B (29K, 9 slides, grid + templates + decorative shapes)
  - Add 4 custom themes: apex, devportal (DOCX), lumina, meridian (PPTX)
  - Modern table styling: hide vertical inside borders, cell padding, headerCellDefaults
  - Delete 7 low-quality templates: Sales Deck, Company Branding, Product Launch, Dashboard, Charts Demo, quarterly-report, annual-review
  - Remove quarterlyReportExample export from core-docx

### Patch Changes

- 9972863: fix(jto): reinforce `{ name, props }` component format in all PPTX AI prompts to prevent non-compliant template output
- Updated dependencies [b34970d]
  - @json-to-office/core-docx@0.5.0

## 0.4.1

### Patch Changes

- 5b07742: Auto-detect LibreOffice on Windows default install paths

## 0.3.6

### Patch Changes

- 985ac6c: Add explicit "no tools" instruction to AI system prompt so the model outputs JSON directly instead of complaining about missing file-editing tools.

## 0.3.5

### Patch Changes

- 8e99808: Upgrade ai 6.0.116→6.0.141, @ai-sdk/react 3.0.118→3.0.143, ai-sdk-provider-claude-code 3.4.3→3.4.4 to fix stream validation crash on tool-output-available events with providerMetadata.

## 0.3.4

### Patch Changes

- 411fa3e: Disable filesystem tools (Read, Write, Edit, Glob, Grep, Bash, Agent) in AI chat provider to prevent crash when Claude Code autonomously reads large files. Also disable session persistence and improve error detection for oversized requests.

## 0.3.3

### Patch Changes

- ce2016f: fix(jto): include prompt .md files in published package via tsup onSuccess copy
- 3553ec5: fix(jto): always show add buttons for documents and themes in sidebar

## 0.3.2

### Patch Changes

- e96c957: Upgrade Radix UI dependencies and fix vite manualChunks to scope matching to node_modules

## 0.3.0

### Patch Changes

- de674e0: feat(schema): per-container narrowed children validation for DOCX and PPTX

  Each container component now declares its `allowedChildren`, and the schema
  generator builds per-container children unions instead of one flat recursive
  union. Monaco immediately flags invalid nesting (e.g. heading inside docx).

  Also skips auto-builds when JSON is syntactically invalid or has schema
  validation errors, preventing wasted server roundtrips during typing.

- Updated dependencies [de674e0]
  - @json-to-office/shared-docx@0.3.0
  - @json-to-office/shared-pptx@0.3.0
  - @json-to-office/core-docx@0.3.0
  - @json-to-office/core-pptx@0.3.0

## 0.2.1

### Patch Changes

- 94314f8: Redesign plugin sidebar UX: inline Switch toggles, active/inactive state, split-pane detail modal

## 0.2.0

### Minor Changes

- 1db99a3: Extract shared plugin infrastructure from core-docx into shared package and add plugin system for PPTX generation

### Patch Changes

- Updated dependencies [1db99a3]
  - @json-to-office/shared@0.2.0
  - @json-to-office/core-pptx@0.2.0
  - @json-to-office/core-docx@0.2.0
  - @json-to-office/shared-docx@0.2.0
  - @json-to-office/shared-pptx@0.2.0
