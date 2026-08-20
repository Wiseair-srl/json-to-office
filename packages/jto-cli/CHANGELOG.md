# @json-to-office/jto-cli

## 0.34.0

### Patch Changes

- Updated dependencies [2ea0f6a]
- Updated dependencies [4d7c554]
- Updated dependencies [7900859]
- Updated dependencies [ae9b1d4]
- Updated dependencies [912f1b7]
- Updated dependencies [ea6b6af]
- Updated dependencies [234a97e]
- Updated dependencies [34fdb52]
- Updated dependencies [5ea33ff]
- Updated dependencies [1f4e1a5]
- Updated dependencies [ed54627]
- Updated dependencies [4bfe683]
- Updated dependencies [bae9e20]
- Updated dependencies [9e14e7a]
- Updated dependencies [58f5331]
- Updated dependencies [98ca046]
- Updated dependencies [51f958a]
- Updated dependencies [baf0fc8]
- Updated dependencies [ed9ba39]
  - @json-to-office/core-docx@0.34.0
  - @json-to-office/shared-docx@0.34.0

## 0.33.2

### Patch Changes

- d94be7f: Harden on-demand plugin loading for schema generation (review follow-ups to
  the load-on-demand fix):

  - Production keeps its authorization policy: on-demand loading is a
    dev-playground affordance, so in production `/discovery/schemas/document`
    no longer triggers plugin discovery — loading stays behind the
    authenticated `POST /load-plugins`, and schema generation falls back to
    whatever is already registered.
  - `PluginRegistry.discoverAndLoad()` now coalesces concurrent callers into a
    single discovery pass, so the bootstrap POST and on-demand schema loads
    racing on page load no longer double-walk the project or re-import plugins.

## 0.33.0

### Patch Changes

- Updated dependencies [2ae9268]
  - @json-to-office/shared@0.33.0
  - @json-to-office/shared-docx@0.33.0
  - @json-to-office/shared-pptx@0.33.0
  - @json-to-office/core-docx@0.33.0
  - @json-to-office/core-pptx@0.33.0

## 0.32.0

### Patch Changes

- Updated dependencies [b2b0bd3]
- Updated dependencies [0b021e5]
  - @json-to-office/shared-docx@0.32.0
  - @json-to-office/core-docx@0.32.0
  - @json-to-office/shared-pptx@0.32.0
  - @json-to-office/core-pptx@0.32.0

## 0.31.0

### Minor Changes

- 6b0545a: fix: make cache observability truthful and cross-render caching real (#156)

  The Cache Performance modal was structurally blind: component types that
  bypass the cache by design recorded nothing, the visual rasterizer's two
  caches exposed no stats, per-render date keys killed every cross-render
  lookup for date-less documents, repeated `/load-plugins` calls reset the
  stats before they meant anything, and "Clear all caches" wasn't.

  - `core-docx`: design-bypassed renders are counted per type with a reason
    (`getComponentBypassStats`; included in `getComponentCacheStats`). The
    generation date only joins a component's cache key when its props or
    children reference a date-sensitive placeholder (`{DATE}`, `{DATETIME}`,
    `{YEAR}`, custom registrations — `{PAGE}`/`{TOTAL_PAGES}` are field
    codes and excluded), so date-less components hit across renders. The
    visual pre-pass exports cumulative dedupe counters
    (`getVisualPrepassStats`).
  - `jto-cli`: the rasterizer exposes `getRasterizerCacheStats()` (disk
    hits/misses, batch dedupe, rendered/failed, PNG entries and bytes) and
    `clearRasterizerCache()`. `PluginRegistry` fingerprints each loaded set
    (paths + mtimes + sizes): reloading an unchanged set is a no-op — no
    re-import, no cache invalidation — and a changed set invalidates ONCE
    per batch instead of once per plugin.
  - `jto`: `/cache-stats` returns the rasterizer block and bypassed-type
    rows; the modal renders "uncached by design" rows and a Visual
    Rasterizer section. `DELETE /cache` now also clears the component
    render cache and the rasterizer PNG disk cache. The client collapses
    concurrent load-plugins calls into one request.

### Patch Changes

- Updated dependencies [6b0545a]
  - @json-to-office/core-docx@0.31.0

## 0.30.0

### Minor Changes

- 6f27201: fix: make the playground's "Copy standard components" reliable and cheap (#155)

  The action failed two ways: it was silently disabled until the first Run
  (gated on the generated output instead of the editor document), and when it
  did run, the clipboard write happened after a slow server round trip — the
  click's user activation had expired, so Chromium rejected the write with
  `NotAllowedError` even though the request succeeded. The endpoint was slow
  by construction: it used the deprecated `getStandardComponentsDefinition`,
  which runs a full generation (LibreOffice visual rasterization included)
  just to surface the JSON tree.

  - `core-docx`: new `expandStandardDefinition()` on plugin generators —
    validation, theme resolution, custom-component expansion, and
    normalization only. No fonts, no layout, no rendering, no external
    services. Returns `StandardDefinitionResult`.
  - `jto-cli`: `GeneratorResult.getStandardDefinition` wires the new cheap
    path (replaces the deprecated `getStandardComponentsDefinition`
    pass-through, which no longer had in-repo callers).
  - `jto` server: `/standard-components` uses the expansion-only path and
    maps validation failures to 400 instead of 500.
  - `jto` playground: the clipboard write starts synchronously inside the
    click (promise-payload `ClipboardItem`), so the browser authorizes it
    while the gesture is live and the payload resolves when the fetch lands;
    a denied write falls back to a dialog with the JSON and its own Copy
    button. The menu item is enabled from the editor's active document (works
    before the first Run, themes excluded) and explains itself with a tooltip
    when no document is open.

### Patch Changes

- Updated dependencies [6f27201]
  - @json-to-office/core-docx@0.30.0

## 0.29.0

### Minor Changes

- b536bb6: feat: coalesce per-document visual rasterization into batched calls (#153)

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

### Patch Changes

- Updated dependencies [b536bb6]
  - @json-to-office/shared@0.29.0
  - @json-to-office/core-docx@0.29.0
  - @json-to-office/core-pptx@0.29.0
  - @json-to-office/shared-docx@0.29.0
  - @json-to-office/shared-pptx@0.29.0

## 0.28.0

### Minor Changes

- a033a8b: Relative image/media paths now resolve against the document's own directory instead of `process.cwd()` (#142). New `baseDir` option on core generation (`generateBufferFromJson` et al.), plugin builders (constructor + per-call), CLI `generate` (auto-set to the input file's directory), the playground server (via `options.sourceName` mapped through discovery), and the pptx rasterizer request (docx `visual` components forward it). cwd stays the fallback when no baseDir is provided. Stock template media paths shrunk to document-relative `media/...`; stale `templates` entry dropped from `packages/jto` package `files`.

### Patch Changes

- Updated dependencies [a033a8b]
  - @json-to-office/core-docx@0.28.0
  - @json-to-office/core-pptx@0.28.0
  - @json-to-office/shared@0.28.0
  - @json-to-office/shared-docx@0.28.0
  - @json-to-office/shared-pptx@0.28.0

## 0.27.0

### Patch Changes

- Updated dependencies [43defd5]
  - @json-to-office/core-docx@0.27.0
  - @json-to-office/core-pptx@0.27.0

## 0.26.0

### Patch Changes

- Updated dependencies [df039c1]
- Updated dependencies [6aa719e]
  - @json-to-office/core-pptx@0.26.0

## 0.25.0

### Patch Changes

- Updated dependencies [2801ec4]
- Updated dependencies [f3b3674]
- Updated dependencies [96c30b3]
  - @json-to-office/shared-docx@0.25.0
  - @json-to-office/core-docx@0.25.0
  - @json-to-office/core-pptx@0.25.0
  - @json-to-office/shared-pptx@0.25.0
  - @json-to-office/shared@0.25.0

## 0.24.0

### Patch Changes

- Updated dependencies [5e6f5df]
  - @json-to-office/shared-docx@0.24.0
  - @json-to-office/shared-pptx@0.24.0
  - @json-to-office/core-docx@0.24.0
  - @json-to-office/core-pptx@0.24.0

## 0.23.0

### Minor Changes

- cd2f5f4: fix: gate every shipped JSON asset on the schema, and stop themes failing silently

  CI validated `examples/` and nothing else, so anything outside it drifted unchecked: all five bundled DOCX themes had shipped `componentDefaults.table` props the schema rejects (fixed by hand in the previous release, with nothing to stop it recurring), and the playground's "new theme" scaffold was born with 28 validation errors. This adds the missing gate and removes the fallbacks that hid the failures.

  **`pnpm validate:assets` validates every shipped asset, and CI runs it.** Every `*.docx.json`, `*.pptx.json`, `*.docx.theme.json` and `*.pptx.theme.json` under `packages/` and `examples/` — bundled themes, document templates, playground decks — plus every full document sample in `docs/**/*.md`. Docs snippets that are deliberately invalid opt out with `<!-- jto-validate: skip -- reason -->` on the line above the fence; a theme snippet opts in with `<!-- jto-validate: docx-theme -->`. Skipped samples are listed in the output rather than passing quietly.

  **`createMinimalTheme()` moved to `@json-to-office/shared-docx` and is now schema-valid.** It sat next to the parser in `core-docx` and emitted colours without the `#` prefix that `HexColorSchema` requires, so the one helper meant to produce a valid starting theme produced an invalid one. It now lives beside `ThemeConfigSchema`, returns `Static<typeof ThemeConfigSchema>` so a new required property breaks the build, and takes an optional name: `createMinimalTheme('house-style')` sets both `name` and a title-cased `displayName`. `core-docx` re-exports it, so `import { createMinimalTheme } from '@json-to-office/core-docx'` is unchanged.

  **The playground scaffolds new DOCX themes from it.** Creating a theme used to write a hardcoded literal with 5 colours, 2 font roles and no metadata — 28 errors the moment the editor opened it. New themes are now valid on creation. PPTX scaffolding is unchanged; it already matched its schema.

  **A failed template copy no longer falls back to the scaffold.** If `/api/discovery/…/content` failed or had not resolved, the create dialog wrote the default scaffold with only a `console.error`, producing a file named after the template you picked and containing none of it. It now reports the failure and leaves the dialog open. Switching templates also clears the previous one's content, so submitting mid-fetch can no longer write the theme you just navigated away from.

  **`apex` and `devportal` are statically imported like the other three themes.** They existed only via a filesystem scan of `dist/`, so which themes were available depended on build state: a stale `dist` served the old broken copies, and a missing one degraded to `minimal` without a word. The scan remains for genuinely external themes, but now validates before registering instead of trusting whatever it reads.

  **An unresolvable theme name warns instead of silently rendering as `minimal`.** `props.theme` is an unconstrained string and unknown names fell back to `minimal` with no signal — a typo, or a `--theme-path` file whose internal `name` differs from its filename, produced a plausible document in the wrong theme. Generation now emits a `theme_not_found` warning naming what was requested and what is available, and the CLI prints it. The fallback itself is unchanged: a bad name still renders rather than failing. `validateTheme` also stops casting unregistered theme names straight through, and rejects them with the list of valid names.

  The CLI now forwards structured generation warnings from the DOCX pipeline to the terminal generally, not just this one — they were collected and dropped before.

### Patch Changes

- Updated dependencies [cd2f5f4]
  - @json-to-office/shared-docx@0.23.0
  - @json-to-office/core-docx@0.23.0

## 0.22.0

### Minor Changes

- e311268: fix(cli): honour `PORT` in `jto dev`, and drop the dev-server config keys nothing read

  `PORT` was parsed in two places and read in neither: the dev server took its port from `-p`, the config file, or a `server.port === 3003` sentinel that stood in for "the user did not choose a port". The sentinel could not tell an untouched default from a deliberate `3003`, so `jto pptx dev` with `PORT=3003` — or with `"server.port": 3003` in the config file — bound 3004 instead.

  - `loadConfig` resolves the port in one place: config file > `PORT` > the caller's default > the packaged `3003`. `dev -p` still outranks all of them.
  - `loadConfig` takes an optional second argument (`{ defaultPort }`), so `dev` supplies the format's port instead of the loader emitting a magic value the caller has to recognise. The parameter is optional and existing call sites keep working.
  - The returned config is a fresh `structuredClone` of the defaults on every load, including the failure path. `dev -p` writes straight into `config.server.port`, which used to mutate the shared module-level `defaultConfig`, leaking one command's port into every later load in the same process.
  - A config file that fails schema validation still falls back to defaults, but the fallback now honours `PORT` and the caller's default rather than always returning `3003`.
  - The dev-server config schema keeps only what the dev server reads (`mode`, `server.port`, `server.host`, `development.hmrPort`). `server.cors.*`, `api.*`, `playground.*`, `paths.*`, and `development.hmr` / `sourceMap` / `verbose` are gone rather than left to imply an effect they never had. Unknown keys still validate, so a config file that still carries them keeps loading and they keep being ignored. CORS is configured through `CORS_ORIGIN`.
  - `jto`'s server config no longer parses `PORT` and `UPLOAD_DIR` into an object nobody consulted; the listener's port comes from the CLI config above.

  **Behaviour changes to expect when upgrading:**

  - **`PORT` now decides the dev-server port** when `-p` is absent and the config file sets no `server.port`. A deployment that exports `PORT` for some other process and previously landed on 3003/3004 will now bind `$PORT`. Pin the port with `-p` or `server.port` if you need the old value.
  - **`PORT=3003 jto pptx dev` binds 3003**, not 3004.

  Port parsing is strict: `Number.parseInt` stops at the first non-digit, so `PORT=8080x` used to bind 8080. Both `PORT` and `--port` now require a complete integer in range, and an invalid `--port` fails with a clear message instead of silently binding elsewhere. `loadConfig` also survives a malformed config file — a top-level `null`, or `"server": null`, previously threw while computing the fallback port and skipped the warn-and-default path that exists for exactly that case.

- e311268: fix(cli): make `--theme` / `--theme-path` and the config file's theme keys actually select the theme

  Theme selection was wired up in only half the code paths. Without plugins, `createGenerator`/`generateBuffer` passed `customThemes` and nothing else, so `--theme` was ignored outright and `--theme-path` only worked if the document's `props.theme` happened to name the loaded theme. With plugins, an unknown `--theme` quietly resolved to a built-in default. And in `PluginConfigService.mergeWithOptions`, every CLI option was spread over the config file including the absent ones, so an unset flag overwrote the matching config-file key with `undefined`.

  - A requested theme now applies on **both** paths. It is registered under a reserved `customThemes` key (`jto-cli-theme`) and the document's `props.theme` is rewritten to point at it. With no theme requested, the document is passed through untouched and `props.theme` stays in charge — on the plugin path too, where the generator is now constructed with no `theme` at all rather than a `minimal` default that would have restyled every document.
  - `--theme` also resolves against the supplied `customThemes` map before trying built-in names and file paths.
  - A theme that resolves to nothing — an unknown built-in name, an unreadable file — prints `Unknown theme "X"; keeping the document's own theme` and leaves the document's theme alone. PPTX no longer routes unknown names through `getPptxTheme()`, which answered every one of them with the default theme.
  - The theme is resolved **once per generator**, and `--theme-path` is read exactly once inside that resolution. Without plugins the read moved off the per-document path, so a batch of documents produces one `Failed to load theme from …` warning instead of one per document. With plugins it used to be read twice at `createGenerator()` time — once for the requested theme, once for the `customThemes` registry — and printed that warning twice for a single bad path; one read now feeds both.
  - Absent CLI flags no longer erase config-file values. `theme`, `themePath`, `validation.allowUnknownFields`, `discovery`, and `aliases` from the config file now take effect when the matching flag is not passed.

  **Behaviour changes to expect when upgrading:**

  - **A document's own `props.theme` no longer wins over a requested theme.** If you pass `--theme`/`--theme-path`, or your config file sets `theme`/`themePath`, documents that named their own theme now render with the requested one. Drop the flag and the config keys to go back to per-document themes.
  - **Config-file `theme` / `themePath` now apply to `generate`.** They were previously wiped by the unset flags and had no effect; a config file left over from that period will start changing output.
  - **`theme` and `themePath` merge as one group, not key by key.** Passing either flag supersedes _both_ config-file keys; with neither flag, the config file keeps both and its own `themePath`-before-`theme` order. Previously a config-file `themePath` outranked an explicit `--theme`, which is the case this changes.
  - **A mistyped `--theme` no longer silently swaps in a default theme.** It warns and keeps the document's theme, so a typo now shows up as a warning plus unchanged styling instead of a differently styled file.
  - **The `Theme:` summary line reports the theme that rendered** instead of echoing the `--theme` flag. It previously printed the `--theme` value or, whenever that flag was absent, the literal `default`. Now: `--theme-path` prints the file path (it printed `default`), config-file `theme`/`themePath` print what they resolved to (they printed `default`, since the unset flags wiped them), an unrecognised `--theme` prints the document's own theme or `default` (it printed the misspelling), `--theme` and `--theme-path` together print the path that won (it printed the `--theme` name), and a document-level `props.theme` is named rather than reported as `default`. A resolved plain `--theme` still prints that name. Scripts scraping the line need updating.
  - **A bad `--theme-path` warns once on plugin-loaded runs, not twice.** Anything counting CLI diagnostics sees one fewer.

### Patch Changes

- e311268: fix(cli): forward `--no-google-fonts` to the generator

  `generate` read `options.noGoogleFonts`, a key Commander never sets: a `--no-x` flag is delivered as `options.x === false`. The condition was therefore never true and the flag was inert. It now sets `fonts.googleFonts.enabled: false` on the generator options, alongside `--font-cache-dir`.

  This does not change generated files — `generate` performs no Google Fonts fetching in the first place (fetching happens only in the dev-server preview pipeline) — but the flag now reaches the generator configuration as documented, instead of being dropped before it gets there.

- Updated dependencies [e311268]
- Updated dependencies [e311268]
- Updated dependencies [e311268]
- Updated dependencies [e311268]
- Updated dependencies [e311268]
- Updated dependencies [e311268]
- Updated dependencies [e311268]
  - @json-to-office/shared@0.22.0
  - @json-to-office/shared-docx@0.22.0
  - @json-to-office/core-docx@0.22.0
  - @json-to-office/core-pptx@0.22.0
  - @json-to-office/shared-pptx@0.22.0

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
  - @json-to-office/shared-docx@0.21.0
  - @json-to-office/shared-pptx@0.21.0
  - @json-to-office/shared@0.21.0

## 0.20.0

### Minor Changes

- bc15ebf: feat(pptx): real validation for `pptx validate` — deep, path-aware checking of whole presentations

  `jto pptx validate` previously returned valid unconditionally: unknown component names, dead props (e.g. `fontColor` on `text`), and malformed trees all passed. shared-pptx now ships a unified validation facade (`validate` / `validateStrict`) mirroring shared-docx: a deep walk validates every component's props against its registry schema with precise JSON-pointer paths, enforces container narrowing (`pptx` → `slide` → content), rejects children on leaf components and unknown top-level fields, validates slide `placeholders` values, checks image source mutual exclusivity, and validates themes against `ThemeConfigSchema`. The CLI wires both `pptx` document and theme validation to it, and a missing/broken validation module now reports an error instead of silently passing the file.

### Patch Changes

- Updated dependencies [bc15ebf]
- Updated dependencies [bc15ebf]
- Updated dependencies [de4d21c]
  - @json-to-office/core-pptx@0.20.0
  - @json-to-office/core-docx@0.20.0
  - @json-to-office/shared-pptx@0.20.0
  - @json-to-office/shared-docx@0.20.0

## 0.19.0

### Patch Changes

- Updated dependencies [a332658]
  - @json-to-office/shared-docx@0.19.0
  - @json-to-office/shared-pptx@0.19.0
  - @json-to-office/core-docx@0.19.0
  - @json-to-office/core-pptx@0.19.0

## 0.18.0

### Patch Changes

- Updated dependencies [a079015]
- Updated dependencies [71faefc]
  - @json-to-office/core-docx@0.18.0
  - @json-to-office/shared-docx@0.18.0
  - @json-to-office/core-pptx@0.18.0
  - @json-to-office/shared-pptx@0.18.0

## 0.17.0

### Patch Changes

- Updated dependencies [542f8ad]
  - @json-to-office/shared-docx@0.17.0
  - @json-to-office/core-docx@0.17.0

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

### Patch Changes

- Updated dependencies [8744ad2]
- Updated dependencies [755d812]
  - @json-to-office/shared@0.13.0
  - @json-to-office/core-docx@0.13.0
  - @json-to-office/core-pptx@0.13.0
  - @json-to-office/shared-docx@0.13.0
  - @json-to-office/shared-pptx@0.13.0

## 0.12.0

### Patch Changes

- Updated dependencies [c4a57aa]
- Updated dependencies [c4a57aa]
  - @json-to-office/core-docx@0.12.0
  - @json-to-office/shared@0.12.0
  - @json-to-office/core-pptx@0.12.0
  - @json-to-office/shared-docx@0.12.0
  - @json-to-office/shared-pptx@0.12.0

## 0.11.0

### Minor Changes

- 7f9679b: Introduce `@json-to-office/jto-cli`, a lightweight CLI package containing only the non-playground commands (`generate`, `validate`, `schemas`, `discover`, `init`, `fonts`). Install it instead of `@json-to-office/jto` in CI or scripting contexts to skip the React/Monaco/Vite/AI-SDK playground deps.

  `@json-to-office/jto` is unchanged for users — it now depends on `jto-cli` and adds the `dev` playground command on top, so `jto docx dev` / `jto pptx dev` still work as before.

  Note: the binary in `@json-to-office/jto-cli` is `jto-cli`, not `jto` — update CI scripts that previously invoked `jto` accordingly.
