# @json-to-office/jto

## 0.24.0

### Minor Changes

- 5e6f5df: Rebuild the playground sidebar around the files you have open.

  The rail carried two competing ideas at once. "Active Documents" and "Active
  Themes" were the working set; "Discovered Resources" was the library — but the
  library nested its files two levels deep (Discovered Resources → Project
  Documents → the file), so a 256px column spent roughly 40px of its width on
  chrome before showing a filename. There was no way to search any of it. With a
  dozen documents, themes and plugins in the project, scanning was the slowest
  thing about the panel.

  The library sections are now top level, one indent, one neutral tree guide. A
  single filter across the top narrows open files, project files and plugins
  together, auto-expanding whatever still has matches; `/` focuses it, `Esc`
  clears it, and matched runs are marked with weight rather than a tint, because
  every hue in this rail already means something.

  State reads more precisely and more quietly. The file icon no longer swaps to a
  play glyph when a document is previewing — that swap cost the only cue
  distinguishing a document from a theme. Instead exactly one row carries a filled
  bed and a `--primary` stripe (the one the editor has open), while previewing and
  theme-in-use are marked with a `--data-blue` or `--warning` dot on the trailing
  edge. Decorative left stripes are gone from the library rows, so a stripe now
  only ever means "open in the editor". The collapsed rail shows real file icons
  in place of two-letter monograms, which had rendered both `contract-v1` and
  `contract-v2` as "CO".

  Rows are denser (28px, 13px text, 14px icons) and each one reveals an overflow
  menu on hover — rename, download and delete had been reachable only by
  right-clicking. Empty sections are buttons that create the thing they are empty
  of. Plugin names now label their switch, so toggling a plugin is a 28px row
  target rather than an 18px track.

  Muted text was recalibrated: several rail values sat below WCAG AA (section
  labels at 3.4:1, counts at 2.1:1). Rail text now lives in a documented
  `/65`–`/85` opacity band and takes its hierarchy from size, weight and uppercase
  tracking instead of fading out.

  Two dead paths went with the rewrite: a `SchemaDialog` whose open-state setter
  was never called, and a per-render `JSON.parse` of every open document feeding an
  indicator prop the row component ignored.

- 5e6f5df: Align the playground UI with the Wiseair design system.

  The playground now runs on the Banani tokens from `wiseair-mono/apps/dashboard`.
  Light is the cool-grey enterprise surface (canvas `#f4f6f9`, white panels,
  `#e2e6ed` hairlines, Brand Slate `#383F5D` primary, `#546f9c` secondary text).
  Dark is a surface ramp rather than one flat near-black — canvas `#1D2130` → card
  `#282c3e` → subtle fill `#3b4054` → border `#494e65`, over a recessed `#10141e`
  sidebar rail — so cards, popovers and muted fills stay distinguishable from each
  other. Also: the 2/4/6/10px radius ladder, the dense 11/13/14/16/20/24/30/36
  type scale, and self-hosted Inter in place of Geist (dropping a render-blocking
  Google Fonts request).

  Ad-hoc Tailwind palette colors scattered across the sidebar, warnings panel,
  preview status bar and schema viewer are gone; document and theme states now use
  the system's own vocabulary (`success`, `warning`, `destructive`, `data-blue`,
  `accent2`, `header-bg`, `sidebar-accent`) with the dashboard's soft-wash callout
  recipe, so they read as one system in both themes.

  Components follow the same recipes: flat surfaces separated by hairlines rather
  than shadows, 2px-cornered controls, 4px badges, 6px floating overlays. The
  Monaco editor gets `jto-light` / `jto-dark` themes so the editor pane is painted
  from the same surface tokens as the rest of the shell instead of stock white /
  `#1E1E1E`.

### Patch Changes

- 5e6f5df: Say "component" everywhere; drop the last traces of the old `modules` format.

  The JSON tree has one node kind — `{ name, props, children? }` — in two
  flavours, base and custom. But an earlier format nested `modules` inside
  `modules`, and its vocabulary outlived it. The README and the architecture guide
  both opened by describing documents as "a tree of **modules**, each module
  containing base components", a hierarchy that no longer exists and that the code
  sample directly beneath contradicted. Schema descriptions called section
  header/footer arrays "modules", and a validation hint told authors to check
  their "module type" — a phrase they would find nowhere in the schema. All of
  these now say component, matching what the validator actually reports.

  Two dead things went with it. `DOC_LINKS` is **removed** from the
  `@json-to-office/shared-docx` public surface: it was consumed nowhere, and all
  three of its URLs pointed at a `json-to-docx.com` docs domain the project no
  longer uses. `core-docx`'s `examples/test-spacing-debug.ts` is deleted — it was
  written in the superseded `type`/`config`/`modules` shape, so it could not
  render against the current parser, yet still compiled as part of the package.

  The error-message change is behavioural, not just cosmetic: the generic
  union catch-all detector in both deep validators matched
  `/invalid (component|module) configurations?/`, and the union-array hint
  branched on `path?.includes('modules')`. No message producer has emitted
  "module" for some time and no path segment is named `modules`, so both branches
  were unreachable; they now match only what is actually emitted.

- Updated dependencies [5e6f5df]
  - @json-to-office/shared-docx@0.24.0
  - @json-to-office/shared-pptx@0.24.0
  - @json-to-office/core-docx@0.24.0
  - @json-to-office/jto-cli@0.24.0
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
  - @json-to-office/jto-cli@0.23.0

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

### Patch Changes

- Updated dependencies [e311268]
- Updated dependencies [e311268]
- Updated dependencies [e311268]
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
  - @json-to-office/jto-cli@0.22.0
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
