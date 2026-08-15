# @json-to-office/core-docx

## 0.22.0

### Minor Changes

- e311268: feat(themes): one chart palette vocabulary for DOCX and PPTX

  The default chart palette was declared twice with two different token lists: PPTX resolved `primary, secondary, accent, accent4, accent5, accent6`, while the DOCX `highcharts` component resolved only `primary, secondary, accent` — and the DOCX theme schema had no way to spell the other three, so a document could not reach them even deliberately.

  - `DEFAULT_CHART_THEME_COLORS` moves to `@json-to-office/shared` and is exported from its root. `@json-to-office/core-pptx`'s `utils/color` re-exports it, so every PPTX call site keeps importing colours from the module it already used.
  - The DOCX `ThemeConfigSchema` gains optional `accent4`, `accent5`, and `accent6`, named to match the PPTX theme. The schema is strictly more permissive: a theme JSON carrying those keys used to be rejected at load and is now accepted, and every theme that validated before still validates.
  - The DOCX `highcharts` component resolves all six tokens, in the same order PPTX does. A theme that fills every slot with a hex value now produces the same palette in a document and in a deck, letter case included.
  - **Both** chart palettes resolve each token through the theme's own recursive name resolution instead of prefixing a `#` to the raw value. `"accent4": "primary"` used to post the literal string `"#primary"` to the export server and now posts the colour `primary` holds; a value that resolves to nothing (a typo'd token name, or a reference cycle) is skipped instead of being handed to the renderer verbatim. A token whose value is literal hex — every bundled theme and the overwhelming majority of custom ones — produces a byte-identical payload, original letter case included.

    On the PPTX side this was the same defect with a worse symptom: `"accent4": "primary"` reached pptxgenjs as the literal token name, which it answered by painting the series **black** and logging to the console while the generation `warnings` array stayed empty and the exit code stayed 0. Both the native `chart` and the `highcharts` paths were affected. A PPTX theme colour that is defined but resolves to nothing now raises an `UNKNOWN_COLOR` warning and falls back to `primary` instead of being passed through unvalidated — and because that lives in `resolveColor`, it applies to **every** PPTX colour prop (text, shape, table, image, template), not only charts. Callers counting warnings on a broken theme will see one more; nothing changes for a theme whose colours are all literal hex, which is every bundled PPTX theme.

    Note the asymmetry in what the two schemas will even accept: a DOCX theme colour may be `#RRGGBB` or another colour's name, while a PPTX theme colour must be strict hex, so a PPTX reference chain only arrives through a theme the schema never validates — a `customThemes` object, a `--theme-path` file (parsed as plain JSON), or an inline `props.theme` in a run that never calls the validator. Those are exactly the paths where the black series showed up.

    When _no_ token resolves — a hand-written theme whose colours are all CSS names, say — the native `chart` now leaves `chartColors` unset instead of passing an empty array. pptxgenjs indexes `chartColors[i % 0]`, gets `undefined`, and paints every series black without warning; omitting the option hands it its own default palette. The `highcharts` paths already guarded this.

    One deliberate divergence: a reference cycle is "unresolvable" on the PPTX side (dropped from the implicit palette, `UNKNOWN_COLOR` when named explicitly), because `chainToHex` carries a `seen` guard. DOCX's `resolveColor` has no cycle guard; the chart palette catches the resulting stack overflow and drops the slot, but naming a cycled token from an ordinary colour prop still blows the stack.

  **Charts recolour only where a theme actually defines the new tokens.** The five bundled DOCX themes define none, so their charts keep the three-colour palette they had. A theme handed to the library as an object — through `customThemes`, or the `theme` option on `createDocumentGenerator` — that already carried `accent4`–`accent6` bypassed schema validation and was silently ignored by DOCX charts; those charts now pick the extra colours up. Explicit `options.colors` still wins everywhere.

  **Both formats now treat a slot the theme leaves unset the same way: they skip it.** The implicit palette is only as long as the theme has tokens defined, no warning is emitted, and the chart library reuses the shorter list. Skipping compacts rather than leaving a gap — a theme with `accent5` but no `accent4` yields `[primary, secondary, accent, accent5]`, so `accent5` paints the fourth series. An explicit palette is unaffected: a `highcharts` `options.colors` is still forwarded untouched in both formats, and a PPTX `chartColors` entry naming an unset token still resolves to `primary` with a `THEME_COLOR_FALLBACK` warning, because naming a token you never defined is an authoring error rather than a partially filled theme.

  That unification is the PPTX-side behaviour change: a PPTX theme leaving `accent4`–`accent6` unset used to get a six-entry palette with `primary` repeated in slots 4–6, plus three `THEME_COLOR_FALLBACK` warnings per chart. It now gets a shorter palette and no warnings, so series 4+ cycle the theme's colours instead of all painting `primary`. All three bundled PPTX themes fill every slot, so decks on a bundled theme are unchanged; custom PPTX themes with holes will see charts recolour and pipeline warning counts drop. DOCX already skipped and is unchanged in this respect.

  `resolveColor`, `isValidColorName` and `getAvailableColorNames` in core-docx also stopped keying off `in`: an optional colour slot that is present but `undefined` counts as unset everywhere. `resolveColor` raises the same strict `Invalid color value` error as for an absent slot rather than a `TypeError`, `isValidColorName` returns `false` for that slot, and `getAvailableColorNames` omits it.

- e311268: feat(docx): write `props.metadata` into the document properties

  `metadata` was accepted, validated, and then dropped: `new Document({…})` was constructed without any core properties, so nothing the author wrote reached the `.docx`. Word showed an empty Properties panel and the fields were invisible to search and DMS indexing.

  The generated package now carries them: `title`, `subtitle` → `dc:subject`, `description`, `author` → `dc:creator` and `cp:lastModifiedBy`, `tags` → `cp:keywords`, and `company` plus `version` as `Company` / `Version` entries in `docProps/custom.xml` (Word has no core-property slot for either). Documents that set `metadata` therefore produce different bytes than before, and generation stays deterministic.

  **`metadata.created` and `metadata.modified` are removed from the schema.** They could not be honoured: docx stamps `dcterms:created` / `dcterms:modified` with the wall clock and exposes no override, so the values were silently discarded on every build. Because `metadata` is `additionalProperties: false`, a document that still sets them now fails validation with `Document validation failed` instead of being accepted and ignored — the rendered bytes are identical either way. Delete the two keys; set the package timestamps through the `generatedAt` generation option, which is what controls them. `validation.allowUnknownFields: true` strips them if you need a stopgap.

  `metadata.date` is unaffected: it drives `{DATE}` / `{DATETIME}` placeholder resolution, not the package timestamps. The schema descriptions now say where each field lands.

- e311268: fix(docx): apply theme `componentDefaults` to components written without a `props` key

  `resolveComponentDefaults` returned early when a component had no `props` key at all, so theme defaults reached `{"name": "section", "props": {}, …}` but not `{"name": "section", …}`. A missing `props` is now treated as `{}`, and every component picks up its theme defaults regardless of how it was written.

  **The root `docx` node no longer crashes without `props`.** `validateDocument` / `validateJsonComponent` accept a propless root, but generation then read `document.props.theme` unguarded and died with `TypeError: Cannot read properties of undefined (reading 'theme')`. Both entry points — `generateDocumentWithCustomThemes` and the plugin builder in `createDocumentGenerator` — now normalise a missing root `props` to `{}` before anything downstream touches it, which also covers the unguarded reads in `processDocument` (`componentDefaults`, `noProofWords`, `trackRevisions`, `language`, `metadata`). This only widens what generates: a root that carries `props` keeps its object identity, so every existing output is byte-for-byte unchanged, and a propless root now produces bytes identical to the same document written with `"props": {}`.

  Note that the published DOCX JSON Schema still marks the root's `props` as required, so an editor honouring `$schema` flags a propless root that the library now happily builds. Writing `"props": {}` remains the correct thing to do; reconciling the two layers is a separate change.

  **This repaginates existing documents.** A titleless `section` with no `props` key used to miss `componentDefaults.section` and fall back to the built-in `pageBreak: true`, starting a new page. All five bundled themes set `section.pageBreak: false`, so those sections no longer break the page. Write `"props": { "pageBreak": true }` on the section to get the page break back. The same correction applies to every other component with theme defaults (`heading`, `paragraph`, `image`, `statistic`, `table`, `columns`, `list`) — a propless node now inherits them.

  The bundled themes also drop five `componentDefaults.table` keys that no renderer ever read and that the theme schema rejects: `borders`, `striped`, `headerBackground`, `headerColor`, and `borderWidth`. All five bundled themes now pass `validateThemeJson`, which they did not before; rendering is unchanged, because nothing consumed those keys. If you copied a bundled theme as a starting point, remove them — the settings that do exist are `componentDefaults.table.headerCellDefaults.backgroundColor` / `.color`, `hideBorders`, and `borderSize`. There is no theme-level row striping.

  The same treatment now reaches the document root, and the exported JSON Schema agrees: `props` is marked optional there, so a schema-driven editor no longer flags a propless root that the generator accepts. Only an absent or `undefined` `props` is defaulted — an explicit `null`, `false` or `""` stays as written and is rejected by validation instead of being rewritten into a valid shape.

- e311268: fix(docx): repeat table headers by default, and resolve cell colours through the theme

  Two table fixes that change how already-shipped documents render.

  **Header rows now repeat across page breaks.** `repeatHeaderOnPageBreak` has carried `default: true` in the exported JSON Schema since it was introduced, but `createTable` forwarded the raw prop to docx, so an omitted value meant "do not repeat" — the schema and the renderer disagreed. Any table that spans a page break and never set the prop explicitly will now show its header row at the top of each page. Set `"repeatHeaderOnPageBreak": false` on the table to keep the old rendering. The prop description (which said "Defaults to false") now matches the schema.

  **Cell `color` / `backgroundColor` accept theme colour names.** Both were handed to docx verbatim, so only a 6-digit hex (with or without `#`) and `"auto"` ever produced a file: a theme colour name such as `"primary"`, a CSS keyword, or a typo aborted generation with docx's internal `Invalid hex value 'x'. Expected 6 digit hex value`. They now resolve the same way paragraph and heading colours do — theme colour name or `#RRGGBB` — with bare 6-digit hex and `"auto"` still accepted. Bare hex is normalised to uppercase on the way through, as `#RRGGBB` values already were, so a cell written `"backgroundColor": "abc123"` now reaches docx as `ABC123`. An unresolvable value still stops generation, but with a message that names the offending prop and lists what it accepts.

  `"transparent"` is a `backgroundColor`-only sentinel (it is consumed at the shading site and has no `w:color` meaning). On `backgroundColor` it behaves as before; on `color` it used to abort generation inside docx and is now ignored, with a `TABLE_CELL_COLOR_INVALID` warning, so the cell's text takes the table style's colour. Documents that set `color: "transparent"` on a cell previously failed to build and will now build — check those cells if you were relying on the failure.

### Patch Changes

- e311268: fix(docx): stop the schema promising things the renderer does not do

  **`text-box` `style.shading.fill` is now typed as a colour.** It was a bare `Type.String()`, but the value goes to `resolveColor`, which accepts `#RRGGBB` or a theme colour name and throws on everything else. Malformed fills therefore passed validation and blew up mid-render. `fill` now shares `HexColorSchema` with the border colours next to it, so those values are rejected up front — by `jto docx validate` and in the playground — instead of at generation time. Nothing that used to render stops rendering: `resolveColor` never accepted the newly rejected shapes (`rgb(…)`, `#abc`, digit-leading bare hex like `0F0FDF`) in the first place. If a document of yours starts failing validation here, it was already failing to generate.

  **`toc` `numberingStyle` is documented as the no-op it is.** Word's table-of-contents field carries no numbering switch — entries inherit numbering from the heading styles they point at — so the renderer has never been able to apply this prop. It stays in the schema for compatibility, its description now says so, and setting it logs a warning during generation rather than being silently swallowed. Remove it from your documents; control TOC numbering through the heading styles instead.

  `resolveColor` also accepts a bare 6-digit hex (`F0FDF4`). The shared colour pattern admits a letter-leading bare hex through its theme-name branch, so that shape used to validate and then throw mid-render; table cells and the chart palette already special-cased it. No theme colour name is six hex characters, so there is no ambiguity. `isValidColorName` / `getAvailableColorNames` now follow the reference chain too, so a token aliased to an unset slot is no longer reported as usable.

- Updated dependencies [e311268]
- Updated dependencies [e311268]
- Updated dependencies [e311268]
- Updated dependencies [e311268]
  - @json-to-office/shared@0.22.0
  - @json-to-office/shared-docx@0.22.0

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
  - @json-to-office/shared-docx@0.21.0
  - @json-to-office/shared@0.21.0

## 0.20.0

### Minor Changes

- bc15ebf: feat(docx,pptx): highcharts charts follow the document theme by default

  The `highcharts` component forwarded its config verbatim, so charts with no explicit `colors` rendered in the Highcharts default palette (blue-first) regardless of theme. When `options.colors` is absent, the renderer now injects the theme palette — pptx uses the same token list as the native `chart` component (primary, secondary, accent, accent4-6); docx uses primary/secondary/accent. Explicit `colors` always wins, so existing configs that set colors are unchanged.

### Patch Changes

- @json-to-office/shared-docx@0.20.0

## 0.19.0

### Minor Changes

- a332658: feat(docx,pptx): document-level default language with per-component overrides

  Documents and presentations can now declare a default proofing/spell-check language, with local overrides on the components where it makes sense.

  - **docx**: `props.language` (BCP-47, e.g. `"en-US"`) sets Word's document default via `docDefaults` (`w:docDefaults/w:rPrDefault/w:lang`). `paragraph` and `heading` gain a `language` override (emits a run-level `w:lang`) and a `noProof` toggle (emits `w:noProof`) to skip spell/grammar checking on code snippets, identifiers, etc. Runs without an override inherit the document default.
  - **docx `noProofWords`**: a "known words" allowlist on the document (`props.noProofWords`) — and per `paragraph`/`heading`, merged with the document list. Every whole-word, case-insensitive occurrence is split into its own `w:noProof` run so Word never flags it (brand names, technical terms), while the surrounding text stays spell-checked. A portable, document-embedded stand-in for a custom dictionary, since Word's real dictionaries can't be shipped inside a `.docx`. Applies across decorated text, hyperlinks and placeholders. (docx-only.)
  - **pptx**: `props.language` sets the default language for every text run (pptxgenjs `lang`), and `text` gains a `language` override. `noProof` is docx-only — PowerPoint's text runs don't expose a no-proof flag through pptxgenjs.

  Threaded through the shared schemas, the docx style/run pipeline (`createWordStyles`, `createText`, `createHeading`, the markdown/placeholder text-run builders) and the pptx slide context, so the language survives decorators, hyperlinks and placeholders.

### Patch Changes

- Updated dependencies [a332658]
  - @json-to-office/shared-docx@0.19.0

## 0.18.0

### Minor Changes

- a079015: feat: forward `resources` from the highcharts component to the export server, and accept raw inline SVG markup as an image source (docx + pptx)

  **Highcharts `resources` (docx + pptx).** The `highcharts` component gains an optional `resources` prop (`{ css?, js?, files? }`) that is passed through verbatim to the Highcharts Export Server's `/export` payload. This unlocks the server's native `resources` contract — notably `@font-face` rules in `css` pointing at web-hosted `.woff2` files, so charts can render in custom fonts (e.g. Manrope, Carlito). Fully backward compatible: when `resources` is omitted the request body is byte-identical to before (no `resources` key sent). The object is forwarded as-is — no transform, re-serialize, or key stripping. In docx, `resources` is part of the component props, so it is already part of the render cache key — two charts differing only by `resources` are not deduped to the same image.

  **Inline SVG image source (docx + pptx).** The `image` component gains an `svg` prop alongside `path`/`base64`, so callers can drop raw `<svg>…</svg>` markup straight into the JSON instead of encoding it as a data URI or pointing at a file. Source precedence is `svg > base64 > path`; the markup is wrapped into an `image/svg+xml` data URI and flows through the existing pipeline. In docx it renders as a true vector (Word 2016+, with the usual PNG fallback) and honors width/height (intrinsic viewBox size when omitted), `%` widths, alignment, caption, floating, and table-cell placement; resolution is centralized in a shared `resolveImageSource()` helper used by every image render path (block, table cell, column layout), and document validation rejects an image that sets more than one of `path`/`base64`/`svg` with a path-aware error. In pptx the same `svg` source is embedded as a vector (PowerPoint 2016+, with pptxgenjs's PNG fallback) and participates in intrinsic-aspect auto-sizing (e.g. width-only → height derived from the viewBox) via the same precedence helper. Adds an `eldermoor-census` example custom component (docx) demonstrating how to expose structured data props and render them via the inline `svg` image source.

### Patch Changes

- Updated dependencies [a079015]
  - @json-to-office/shared-docx@0.18.0

## 0.17.3

### Patch Changes

- f5a6468: fix(docx): honor lineSpacing and spacing on header/footer paragraphs

  Paragraph modules in a section `header`/`footer` were rendered by a separate, minimal code path that only read font (family/size/bold/italic/color), text, and alignment. Any `font.lineSpacing` or paragraph `spacing` (before/after) set on a header/footer paragraph was silently dropped — it never reached the emitted OOXML.

  Header/footer paragraphs now render through the same `createText` primitive as body paragraphs, so they honor `lineSpacing`, `spacing`, and the full font set (also `underline`, `boldColor`, `fontWeight`). Run-level font/size/color resolution against the theme's Normal style is preserved, so existing documents render unchanged unless they set these previously-ignored properties. Markdown link syntax in header/footer text is now parsed into hyperlinks, matching body paragraphs.

## 0.17.1

### Patch Changes

- cfff3aa: fix(docx): validate standard nodes emitted by a custom component's render()

  Generation validation (default on) only validated the input document, before component expansion. A standard component emitted by a custom component's `render()` was never schema-checked, so a document could generate "successfully" while its `standardDefinition` failed standard-schema validation (e.g. when pasted into the playground).

  Each `render()`'s emitted tree is now validated at the boundary with the same gate authored standard components pass through, and the error names the emitting component (`custom component '<name>' emitted invalid output — …`). Honors `validation.enabled` and `validation.allowUnknownFields` like the rest of the pipeline.

## 0.17.0

### Minor Changes

- 542f8ad: fix(docx): surface invalid props on generation instead of silently dropping them

  Closes a correctness gap where the object/buffer generation path accepted malformed input and emitted a silently-wrong document. A typo'd prop such as `lineSpacing: { name: 'single' }` (should be `{ type: 'single' }`) used to be quietly discarded, shipping a document with the property missing. Generation now validates by default — the same check the playground already performs — and reports the error instead of producing corrupt output.

  - **Validation on generation (default on).** `generateDocumentFromJson` / `generateBufferFromJson` validate both string and object input and throw `JsonValidationError` on invalid documents. The plugin generator (`createDocumentGenerator().generate/generateBuffer/generateFile`) validates plugin-aware (standard + registered custom components) and throws `ComponentValidationError`. Need the old pass-through behavior? Set `validation: { enabled: false }`.
  - **Clearer messages for typo'd keys.** Component prop objects reject unknown properties, so a misspelled key surfaces as `Unexpected property "<key>"` rather than being ignored. Highcharts `options` stays an open passthrough.
  - **`allowUnknownFields` opt-out.** `validation: { allowUnknownFields: true }` strips unknown properties instead of rejecting them — a one-line migration aid for documents carrying stray keys. Required and typed fields are still enforced.
  - **Plugin validation fixes.** The plugin generator previously computed validation and discarded the result (so it never reported anything), and `generator.validate()` always returned `{ valid: true }`. Both now work, and registered custom components are no longer mistakenly rejected.

  The playground JSON Schema and the runtime validator both derive from the same TypeBox definitions, so they stay in sync. If a document relied on invalid props being silently dropped, pass `validation: { allowUnknownFields: true }` (strip unknown keys) or `validation: { enabled: false }` (skip validation) to keep the prior behavior.

### Patch Changes

- Updated dependencies [542f8ad]
  - @json-to-office/shared-docx@0.17.0

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

- 8916aaa: fix(docx): built-in minimal/modern themes used "SF Mono" for the mono font,
  which is not a SAFE_FONTS entry — every render logged FONT_UNRESOLVED and fell
  back to a host font. Switched to Menlo (safe, closest match) so built-in
  themes render warning-free out of the box.
- Updated dependencies [afe9789]
  - @json-to-office/shared-docx@0.14.0

## 0.13.0

### Minor Changes

- 8744ad2: feat(core-docx): per-call `preserveCustomComponents` option on `generate` / `generateBuffer` / `generateFile`. Listed component names are kept verbatim (un-expanded) in a new `preservedDefinition` field on the result; `standardDefinition` and the rendered DOCX are unchanged. `generateFile` also writes a JSON sidecar (default `<out>-preserved.json`, override via `preservedOutputPath`). Unknown names throw `UnknownPreservedComponentError` (exported from `@json-to-office/shared` and `@json-to-office/core-docx`).
- 755d812: feat(core-docx): surface `standardDefinition` from `generate` / `generateBuffer` / `generateFile` — the post-expansion JSON tree (custom plugins resolved) is returned alongside the document/buffer at no extra cost. Plugin `render()` previously ran twice when callers used the standalone inspection method together with a generate call, duplicating side effects (e.g. external API hits).

  `getStandardComponentsDefinition` is **deprecated** and now implemented as a thin wrapper around `generate(...).standardDefinition`. Existing callers keep working; migrate by reading `standardDefinition` directly off any `generate*` result. The method will be removed in a future major.

### Patch Changes

- Updated dependencies [8744ad2]
  - @json-to-office/shared@0.13.0
  - @json-to-office/shared-docx@0.13.0

## 0.12.0

### Minor Changes

- c4a57aa: feat(highcharts): allow `services.highcharts.headers` to be a function of the request body, enabling per-request signing/auth derived from payload. Adds `HighchartsHeaders` and `HighchartsHeadersResolver` exports from `@json-to-office/shared`. Static-object form remains supported.

### Patch Changes

- c4a57aa: chore: drop highcharts-export-server peerDependency — server is only called over HTTP, no runtime import; removes install-time approve-build warning for consumers
- Updated dependencies [c4a57aa]
  - @json-to-office/shared@0.12.0
  - @json-to-office/shared-docx@0.12.0

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

## 0.8.0

### Minor Changes

- b1af6ef: Centralize component-defaults resolution into a single tree walk (`resolveComponentTree`) before rendering, removing per-component resolve calls from individual renderers. Support document-level `componentDefaults` override in report/presentation props. Extract shared `deepMerge` utility.

### Patch Changes

- Updated dependencies [b1af6ef]
  - @json-to-office/shared-docx@0.8.0
  - @json-to-office/shared@0.8.0

## 0.7.0

### Minor Changes

- c0bd927: Add generator-level services config for Highcharts export server endpoint and auth headers

### Patch Changes

- Updated dependencies [c0bd927]
  - @json-to-office/shared@0.7.0
  - @json-to-office/shared-docx@0.7.0

## 0.6.0

### Minor Changes

- 84299d3: Remove placeholder header/footer component types and exports. Centralize image type detection and ImageRun construction. Support percentage strings (e.g., "50%") for floating position offsets and wrap margins, resolved against page or available dimensions. Fix table cell backgroundColor defaulting to transparent when unset.

### Patch Changes

- Updated dependencies [84299d3]
  - @json-to-office/shared-docx@0.6.0

## 0.5.0

### Minor Changes

- b34970d: feat: upgrade JSON template examples to Wiseair-level quality

  - Rewrite proposal (apex theme), technical-guide (devportal theme), invoice (modern table styling)
  - Replace Charts Demo with Lumina Analytics deck (39K, 15 slides, all native chart types, grid + templates + decorative shapes)
  - Rewrite pitch-deck as Meridian Series B (29K, 9 slides, grid + templates + decorative shapes)
  - Add 4 custom themes: apex, devportal (DOCX), lumina, meridian (PPTX)
  - Modern table styling: hide vertical inside borders, cell padding, headerCellDefaults
  - Delete 7 low-quality templates: Sales Deck, Company Branding, Product Launch, Dashboard, Charts Demo, quarterly-report, annual-review
  - Remove quarterlyReportExample export from core-docx

## 0.3.1

### Patch Changes

- 3ce62dd: Use theme option as fallback in resolveDocumentTheme, fixing regressions for users migrating from @wiseair-srl/json-to-docx

## 0.3.0

### Patch Changes

- Updated dependencies [de674e0]
  - @json-to-office/shared-docx@0.3.0

## 0.2.0

### Patch Changes

- 1db99a3: Extract shared plugin infrastructure from core-docx into shared package and add plugin system for PPTX generation
- Updated dependencies [1db99a3]
  - @json-to-office/shared@0.2.0
  - @json-to-office/shared-docx@0.2.0
