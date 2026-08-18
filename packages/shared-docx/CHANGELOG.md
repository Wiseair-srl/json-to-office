# @json-to-office/shared-docx

## 0.31.1

### Patch Changes

- 3dac998: Export `props` as optional for components that do not require it.

  Every component variant in the generated JSON Schema listed `props` in
  `required`, including `section`, `toc`, `image` and `text-box`, whose props
  carry no required field. The runtime disagrees: it treats an omitted `props` as
  `{}` and lets the props schema decide. Schema-driven editors trusted the export
  and reddened documents that build — the playground reported 23 errors on the
  shipped `tech-report` template, one per propless `section`. The root `docx` node
  already carried this fix locally; it now applies to every component.

  Root `children` moves into the schema as a required field. It was enforced only
  by the deep validator, which runs on the fallback path taken when the TypeBox
  check has already failed — so it fired only as a side effect of `props` being
  required. CI now validates the stock playground templates against the generated
  schemas, which is what would have caught the drift: the previous step only
  checked two examples that write `props` on every node.

## 0.29.0

### Patch Changes

- Updated dependencies [b536bb6]
  - @json-to-office/shared@0.29.0

## 0.28.0

### Patch Changes

- Updated dependencies [a033a8b]
  - @json-to-office/shared@0.28.0

## 0.25.0

### Minor Changes

- 96c30b3: Capabilities needed to reproduce professionally designed Office templates.

  **PPTX** — `text.runs[]` for per-run styling and `lineSpacingMultiple` for
  percent line spacing; `shape.fill.gradient` (linear/radial) and
  `shape.fill.pattern` (OOXML preset hatches), both injected into slide XML at
  package time since pptxgenjs exposes neither; `shape.angleRange` for
  arc/pie/blockArc/chord plus `flipH`/`flipV`; chart passthrough for
  `dataBorder`, grid lines, axis label fonts and sizes, axis line visibility,
  marker size and bar overlap.

  **DOCX** — paragraph/heading `indent`; paragraph `tabStops` with leaders and
  literal tab runs; `font.scale` for glyph width; `font.size` now accepts up to
  120pt for display typography; and root `props.themeOverrides`, a partial theme
  deep-merged over the named theme so palette tokens, font roles and named styles
  can be defined in-document rather than in an external theme file. `boldColor`
  resolves theme tokens like every other color prop.

  DOCX also gains a single shared generation prologue, so the plain and
  plugin-aware entry points can no longer disagree about theme resolution.

### Patch Changes

- 2801ec4: Fix the playground JSON editor having no schema bound to its models: the
  editor now builds a model URI carrying the format's double extension so it
  matches the schema's `fileMatch`, restoring schema-driven completions,
  validation and hovers. Root `children` in the exported document schema also
  now accepts `section` plus everything a section accepts, matching what the
  validator and generator have always taken.
- Updated dependencies [96c30b3]
  - @json-to-office/shared@0.25.0

## 0.24.0

### Minor Changes

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

- e311268: fix(docx): stop the schema promising things the renderer does not do

  **`text-box` `style.shading.fill` is now typed as a colour.** It was a bare `Type.String()`, but the value goes to `resolveColor`, which accepts `#RRGGBB` or a theme colour name and throws on everything else. Malformed fills therefore passed validation and blew up mid-render. `fill` now shares `HexColorSchema` with the border colours next to it, so those values are rejected up front — by `jto docx validate` and in the playground — instead of at generation time. Nothing that used to render stops rendering: `resolveColor` never accepted the newly rejected shapes (`rgb(…)`, `#abc`, digit-leading bare hex like `0F0FDF`) in the first place. If a document of yours starts failing validation here, it was already failing to generate.

  **`toc` `numberingStyle` is documented as the no-op it is.** Word's table-of-contents field carries no numbering switch — entries inherit numbering from the heading styles they point at — so the renderer has never been able to apply this prop. It stays in the schema for compatibility, its description now says so, and setting it logs a warning during generation rather than being silently swallowed. Remove it from your documents; control TOC numbering through the heading styles instead.

  `resolveColor` also accepts a bare 6-digit hex (`F0FDF4`). The shared colour pattern admits a letter-leading bare hex through its theme-name branch, so that shape used to validate and then throw mid-render; table cells and the chart palette already special-cased it. No theme colour name is six hex characters, so there is no ambiguity. `isValidColorName` / `getAvailableColorNames` now follow the reference chain too, so a token aliased to an unset slot is no longer reported as usable.

### Patch Changes

- e311268: fix(docx): repeat table headers by default, and resolve cell colours through the theme

  Two table fixes that change how already-shipped documents render.

  **Header rows now repeat across page breaks.** `repeatHeaderOnPageBreak` has carried `default: true` in the exported JSON Schema since it was introduced, but `createTable` forwarded the raw prop to docx, so an omitted value meant "do not repeat" — the schema and the renderer disagreed. Any table that spans a page break and never set the prop explicitly will now show its header row at the top of each page. Set `"repeatHeaderOnPageBreak": false` on the table to keep the old rendering. The prop description (which said "Defaults to false") now matches the schema.

  **Cell `color` / `backgroundColor` accept theme colour names.** Both were handed to docx verbatim, so only a 6-digit hex (with or without `#`) and `"auto"` ever produced a file: a theme colour name such as `"primary"`, a CSS keyword, or a typo aborted generation with docx's internal `Invalid hex value 'x'. Expected 6 digit hex value`. They now resolve the same way paragraph and heading colours do — theme colour name or `#RRGGBB` — with bare 6-digit hex and `"auto"` still accepted. Bare hex is normalised to uppercase on the way through, as `#RRGGBB` values already were, so a cell written `"backgroundColor": "abc123"` now reaches docx as `ABC123`. An unresolvable value still stops generation, but with a message that names the offending prop and lists what it accepts.

  `"transparent"` is a `backgroundColor`-only sentinel (it is consumed at the shading site and has no `w:color` meaning). On `backgroundColor` it behaves as before; on `color` it used to abort generation inside docx and is now ignored, with a `TABLE_CELL_COLOR_INVALID` warning, so the cell's text takes the table style's colour. Documents that set `color: "transparent"` on a cell previously failed to build and will now build — check those cells if you were relying on the failure.

- Updated dependencies [e311268]
  - @json-to-office/shared@0.22.0

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
  - @json-to-office/shared@0.21.0

## 0.20.0

### Patch Changes

- Updated dependencies [bc15ebf]
- Updated dependencies [de4d21c]
  - @json-to-office/shared-pptx@0.20.0

## 0.19.1

### Patch Changes

- 2dff712: fix(docx): validate component props in every nested container and in header/footer regions

  The CLI/library document validator (`validate.jsonDocument` / `validate.document`) only re-validated the root's direct children and one level of `section` children. Component props nested inside `text-box`/`columns` children (any depth) and inside section `header`/`footer` regions — which the section schema types loosely as an array of `Type.Any()` (or the `'linkToPrevious'` literal) — were never deep-checked. As a result a document could pass `jto docx validate` (even `--strict`) while still violating the schema (e.g. `boldColor` placed inside `font`, `font.size` above the 72 pt cap, a scalar `characterSpacing`), whereas the in-editor (Monaco) validator — which runs the generated JSON Schema over the whole tree — flagged all of them.

  The deep validator now walks the entire component tree: every container's shared `children` field to any depth, the `header`/`footer` paragraph regions under `props`, and the component content nested inside `table` cells and column headers. A non-array `children` on any nested container (`section`/`columns`/`text-box`) is now reported at its own path too — previously only a `section`'s was, so a deeper malformed subtree could slip through as valid. `header`/`footer` entries are also checked for component structure (not just props), matching the editor's whole-tree schema, which resolves those regions to the component union even though the static section schema types them as `Type.Any()`. No schema or rule changed — only validation coverage.

  This closes the table-cell gap as well: the static cell-content schema types cell `props` as `additionalProperties: true`, so a capped prop deep in a `table` cell (e.g. `font.size` over the cap) used to pass the CLI while the editor's recursive schema rejected it; the walk now re-validates each cell/header content component against its real schema, to any nesting depth (e.g. a table inside a table cell). `list` props (including item formatting) were already covered by the list's own props schema. The CLI and the playground now report the same errors at the same paths.

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
  - @json-to-office/shared-pptx@0.19.0

## 0.18.0

### Minor Changes

- a079015: feat: forward `resources` from the highcharts component to the export server, and accept raw inline SVG markup as an image source (docx + pptx)

  **Highcharts `resources` (docx + pptx).** The `highcharts` component gains an optional `resources` prop (`{ css?, js?, files? }`) that is passed through verbatim to the Highcharts Export Server's `/export` payload. This unlocks the server's native `resources` contract — notably `@font-face` rules in `css` pointing at web-hosted `.woff2` files, so charts can render in custom fonts (e.g. Manrope, Carlito). Fully backward compatible: when `resources` is omitted the request body is byte-identical to before (no `resources` key sent). The object is forwarded as-is — no transform, re-serialize, or key stripping. In docx, `resources` is part of the component props, so it is already part of the render cache key — two charts differing only by `resources` are not deduped to the same image.

  **Inline SVG image source (docx + pptx).** The `image` component gains an `svg` prop alongside `path`/`base64`, so callers can drop raw `<svg>…</svg>` markup straight into the JSON instead of encoding it as a data URI or pointing at a file. Source precedence is `svg > base64 > path`; the markup is wrapped into an `image/svg+xml` data URI and flows through the existing pipeline. In docx it renders as a true vector (Word 2016+, with the usual PNG fallback) and honors width/height (intrinsic viewBox size when omitted), `%` widths, alignment, caption, floating, and table-cell placement; resolution is centralized in a shared `resolveImageSource()` helper used by every image render path (block, table cell, column layout), and document validation rejects an image that sets more than one of `path`/`base64`/`svg` with a path-aware error. In pptx the same `svg` source is embedded as a vector (PowerPoint 2016+, with pptxgenjs's PNG fallback) and participates in intrinsic-aspect auto-sizing (e.g. width-only → height derived from the viewBox) via the same precedence helper. Adds an `eldermoor-census` example custom component (docx) demonstrating how to expose structured data props and render them via the inline `svg` image source.

### Patch Changes

- Updated dependencies [a079015]
- Updated dependencies [71faefc]
  - @json-to-office/shared-pptx@0.18.0

## 0.17.0

### Minor Changes

- 542f8ad: fix(docx): surface invalid props on generation instead of silently dropping them

  Closes a correctness gap where the object/buffer generation path accepted malformed input and emitted a silently-wrong document. A typo'd prop such as `lineSpacing: { name: 'single' }` (should be `{ type: 'single' }`) used to be quietly discarded, shipping a document with the property missing. Generation now validates by default — the same check the playground already performs — and reports the error instead of producing corrupt output.

  - **Validation on generation (default on).** `generateDocumentFromJson` / `generateBufferFromJson` validate both string and object input and throw `JsonValidationError` on invalid documents. The plugin generator (`createDocumentGenerator().generate/generateBuffer/generateFile`) validates plugin-aware (standard + registered custom components) and throws `ComponentValidationError`. Need the old pass-through behavior? Set `validation: { enabled: false }`.
  - **Clearer messages for typo'd keys.** Component prop objects reject unknown properties, so a misspelled key surfaces as `Unexpected property "<key>"` rather than being ignored. Highcharts `options` stays an open passthrough.
  - **`allowUnknownFields` opt-out.** `validation: { allowUnknownFields: true }` strips unknown properties instead of rejecting them — a one-line migration aid for documents carrying stray keys. Required and typed fields are still enforced.
  - **Plugin validation fixes.** The plugin generator previously computed validation and discarded the result (so it never reported anything), and `generator.validate()` always returned `{ valid: true }`. Both now work, and registered custom components are no longer mistakenly rejected.

  The playground JSON Schema and the runtime validator both derive from the same TypeBox definitions, so they stay in sync. If a document relied on invalid props being silently dropped, pass `validation: { allowUnknownFields: true }` (strip unknown keys) or `validation: { enabled: false }` (skip validation) to keep the prior behavior.

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
  - @json-to-office/shared-pptx@0.16.0

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

## 0.13.1

### Patch Changes

- 938bdda: fix(validate): recognize `docx` (and any registered root) in deep validator

  The CLI `validate` command emitted false-negatives — `root: Invalid component
configuration for 'docx'` plus `/name: Unknown component "docx"` — on documents
  that `generate` accepts cleanly. The deep validator's component-schema lookup
  was hardcoded with a stale `report` entry and no `docx` entry, so the root
  `name: "docx"` was reported as unknown.

  The lookup table now comes from `STANDARD_COMPONENTS_REGISTRY` (the single
  source of truth), and the comprehensive validator strips TypeBox's generic
  discriminated-union catch-all so it never appears alongside the precise,
  path-aware diagnostics the deep validator already produces.

## 0.13.0

### Patch Changes

- Updated dependencies [8744ad2]
  - @json-to-office/shared@0.13.0

## 0.12.0

### Patch Changes

- Updated dependencies [c4a57aa]
  - @json-to-office/shared@0.12.0

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

## 0.8.0

### Minor Changes

- b1af6ef: Centralize component-defaults resolution into a single tree walk (`resolveComponentTree`) before rendering, removing per-component resolve calls from individual renderers. Support document-level `componentDefaults` override in report/presentation props. Extract shared `deepMerge` utility.

### Patch Changes

- Updated dependencies [b1af6ef]
  - @json-to-office/shared@0.8.0

## 0.7.0

### Patch Changes

- Updated dependencies [c0bd927]
  - @json-to-office/shared@0.7.0

## 0.6.0

### Minor Changes

- 84299d3: Remove placeholder header/footer component types and exports. Centralize image type detection and ImageRun construction. Support percentage strings (e.g., "50%") for floating position offsets and wrap margins, resolved against page or available dimensions. Fix table cell backgroundColor defaulting to transparent when unset.

## 0.5.3

### Patch Changes

- a89a7cc: feat: use Monaco built-in JSON schema validation for theme editor

  Replace custom `validateThemeJson` marker-setting with Monaco's native `onValidate`, add ValidationPanel/StatusBar UI, and tighten theme schemas with `additionalProperties: false`.

## 0.3.0

### Minor Changes

- de674e0: feat(schema): per-container narrowed children validation for DOCX and PPTX

  Each container component now declares its `allowedChildren`, and the schema
  generator builds per-container children unions instead of one flat recursive
  union. Monaco immediately flags invalid nesting (e.g. heading inside docx).

  Also skips auto-builds when JSON is syntactically invalid or has schema
  validation errors, preventing wasted server roundtrips during typing.

## 0.2.0

### Patch Changes

- 1db99a3: Extract shared plugin infrastructure from core-docx into shared package and add plugin system for PPTX generation
- Updated dependencies [1db99a3]
  - @json-to-office/shared@0.2.0

## 0.1.2

### Patch Changes

- 4c7fadd: Fix docx dependency version: 9.0.4 doesn't exist on npm, aligned to 9.5.1

## 0.1.1

### Patch Changes

- 8175b59: Fix docx dependency version: 9.0.4 doesn't exist on npm, aligned to 9.5.1
