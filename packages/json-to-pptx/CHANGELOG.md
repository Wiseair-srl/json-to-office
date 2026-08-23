# @json-to-office/json-to-pptx

## 1.0.0

### Major Changes

- 39b2ced: PPTX generation now compiles to a renderer-neutral intermediate representation

  Presentations are compiled to `PptxIR` — plain, serialisable data describing a
  finished deck in PowerPoint terms — and a renderer adapter turns that into
  bytes. PptxGenJS is now one backend behind that seam rather than the pipeline
  itself.

  **Output is unchanged.** Every case in the parity corpus produces a
  identical package, part for part, checked against digests recorded from the previous
  implementation (`src/__tests__/corpus-goldens.test.ts`).

  **New**

  - `renderer` option on every PPTX generation entry point and on the plugin
    generator: `'pptxgenjs'` (default) or `'office-open'` (experimental, opt-in).
    An unsupported feature fails before any bytes are produced, with the feature
    name and the IR path that needed it.
  - An experimental `@office-open/pptx` backend, declared as an optional peer
    dependency. It covers text, shapes, images, fills, lines, shadows, plain
    tables, backgrounds, notes, hidden slides, transitions, groups and
    hyperlinks; SVG, native charts, image rotation, vertical flips, masters and
    merged table cells are verified gaps and are rejected up front rather than
    rendered incorrectly.
  - `PptxRendererId`, `DEFAULT_PPTX_RENDERER_ID`, `pptxRendererIds()`,
    `isPptxRendererId()`, `UncompiledComponentError`.
  - `@json-to-office/shared` gains `@json-to-office/shared/rendering`: the
    format-independent renderer contract, capability diffing and structured
    renderer diagnostics.

  **Breaking**

  - `generatePresentation()` — returned a `PptxGenJS` instance — is removed.
    Use `generateBufferFromJson` / `generateBufferWithWarnings`.
  - `savePresentation(pptx, path)` is removed. Use `generateAndSaveFromJson`, or
    write the buffer from `generateBufferFromJson` yourself.
  - `PresentationGenerator.generate` and `PresentationGenerator.save` are removed;
    the remaining members are buffer- and file-oriented.
  - The component renderer exports (`renderTextComponent`, `renderImageComponent`,
    `renderShapeComponent`, `renderTableComponent`, `renderHighchartsComponent`,
    `renderComponent`) are removed — they were the PptxGenJS writer layer.
  - `packagePresentationBuffer` is removed from `@json-to-office/core-pptx`.
    Packaging is split along the seam it was straddling: the PptxGenJS repairs
    (gradient/pattern fill splice, table-style GUID, SVG preview) belong to that
    adapter, and generic OOXML finalization — canonical chart ids, pinned
    timestamps, stable zip encoding — is what every backend gets. Both halves
    share one open zip, so the package is still read once and written once.
  - `PresentationPackagingOptions` no longer carries `pendingFills` or
    `warnings`. Both were adapter plumbing that had leaked into the public
    generation options; what a caller can say is `deterministic` and
    `generatedAt`.

  No public type now references PptxGenJS.

  **Fixed**

  - Image `sizing` (`contain` / `cover`) and aspect-ratio auto-fill are resolved
    in one place with the intrinsic size, rather than partly in the writer.
  - Post-render repairs — the SVG preview fix in particular — report into the
    same structured warning list as the rest of the pipeline on every path,
    including the plugin generator.
  - `underline: false` no longer underlines. Any boolean used to turn underline
    on, so saying `false` switched it on.
  - `bullet: { type: 'bullet' }` now produces a bullet. The object form was
    passed through in a shape the backend ignored; the boolean form always
    worked.
  - `bullet: false` no longer produces a bullet. Every boolean lowered to an
    enabled bullet, so an explicit "no bullet" could not override one inherited
    from a style. `bullet: { type: 'number' }` with no other field now numbers
    rather than clearing the bullet, and a custom glyph reaches both backends
    instead of being dropped by each in its own way.
  - A four-value `margin` keeps the `[top, right, bottom, left]` order the schema
    documents. PptxGenJS's text path reads those four numbers as
    `[left, right, bottom, top]` — disagreeing with its own table path — and the
    office-open adapter read them as `[left, top, right, bottom]`; both are
    corrected in the adapter, so an asymmetric text box is no longer rotated by a
    side.
  - Slide transitions survive processing. `transition` was accepted by the schema
    and dropped before the IR, so `office-open` could not emit one and PptxGenJS —
    which has no transition API — could not refuse it.
  - A rounded table positioned with percentages now gets its rounded backdrop,
    which was previously drawn only when `x` and `y` were plain numbers.
  - The `office-open` backend honours `deterministic` and `generatedAt`. It
    stamped core metadata with the wall clock and numbered drawings from a
    process-global counter, so the same deck rendered twice produced different
    bytes.
  - The `office-open` backend writes the authored theme (`theme1.xml` carries the
    heading and body faces and the resolved palette, where it used to carry
    Office defaults), the `company` document property, and a table's border and
    fill. Five further gaps are now declared rather than silently dropped —
    `image-crop`, `image-rounding`, `table-insets`, `table-rounded-corners` and
    `table-auto-page` — so a deck using them fails with the feature name and the
    IR path instead of losing a crop, a rounded corner or half a table.
  - The parity goldens record what each package _contains_ rather than a hash of
    the file. A golden over raw bytes also asserts that the deflate stream is
    identical, and deflate is the runtime's rather than this pipeline's, so a Node
    release with a different zlib fails every case at once while changing nothing
    about any deck. Byte stability within one runtime is still asserted, by
    rendering twice, and CI now covers both ends of the advertised `>=20` range.

### Minor Changes

- a05a152: Document JSON can now select its renderer with an optional top-level
  `renderer` discriminator. Omission selects `docxjs` for DOCX and `pptxgenjs`
  for PPTX. Generated schemas, runtime validation, autocomplete and exported
  renderer-profile types derive backend-specific branches from the canonical
  component schemas; compiler capability checks remain authoritative after custom
  component expansion and asset resolution.

  Runtime custom-component schemas are rebuilt from the current plugin
  definitions, so reloading the same component name and version cannot reuse stale
  props or child metadata.

### Patch Changes

- Updated dependencies [39b2ced]
- Updated dependencies [a05a152]
- Updated dependencies [d145c9c]
  - @json-to-office/shared@1.0.0
  - @json-to-office/core-pptx@1.0.0
  - @json-to-office/shared-pptx@1.0.0

## 0.36.0

### Patch Changes

- Updated dependencies [c89a2d8]
  - @json-to-office/core-pptx@0.36.0

## 0.35.0

### Patch Changes

- Updated dependencies [30d01dd]
  - @json-to-office/shared@0.35.0
  - @json-to-office/shared-pptx@0.35.0
  - @json-to-office/core-pptx@0.35.0

## 0.33.0

### Patch Changes

- Updated dependencies [2ae9268]
  - @json-to-office/shared@0.33.0
  - @json-to-office/shared-pptx@0.33.0
  - @json-to-office/core-pptx@0.33.0

## 0.32.0

### Patch Changes

- Updated dependencies [0b021e5]
  - @json-to-office/shared-pptx@0.32.0
  - @json-to-office/core-pptx@0.32.0

## 0.29.0

### Patch Changes

- Updated dependencies [b536bb6]
  - @json-to-office/shared@0.29.0
  - @json-to-office/core-pptx@0.29.0
  - @json-to-office/shared-pptx@0.29.0

## 0.28.0

### Patch Changes

- Updated dependencies [a033a8b]
  - @json-to-office/core-pptx@0.28.0
  - @json-to-office/shared@0.28.0
  - @json-to-office/shared-pptx@0.28.0

## 0.27.0

### Patch Changes

- Updated dependencies [43defd5]
  - @json-to-office/core-pptx@0.27.0

## 0.26.0

### Patch Changes

- Updated dependencies [df039c1]
- Updated dependencies [6aa719e]
  - @json-to-office/core-pptx@0.26.0

## 0.25.0

### Patch Changes

- Updated dependencies [f3b3674]
- Updated dependencies [96c30b3]
  - @json-to-office/core-pptx@0.25.0
  - @json-to-office/shared-pptx@0.25.0
  - @json-to-office/shared@0.25.0

## 0.24.0

### Patch Changes

- Updated dependencies [5e6f5df]
  - @json-to-office/shared-pptx@0.24.0
  - @json-to-office/core-pptx@0.24.0

## 0.22.0

### Patch Changes

- Updated dependencies [e311268]
- Updated dependencies [e311268]
- Updated dependencies [e311268]
  - @json-to-office/shared@0.22.0
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
  - @json-to-office/core-pptx@0.21.0
  - @json-to-office/shared-pptx@0.21.0
  - @json-to-office/shared@0.21.0

## 0.20.0

### Patch Changes

- Updated dependencies [bc15ebf]
- Updated dependencies [bc15ebf]
- Updated dependencies [de4d21c]
  - @json-to-office/core-pptx@0.20.0
  - @json-to-office/shared-pptx@0.20.0

## 0.19.0

### Patch Changes

- Updated dependencies [a332658]
  - @json-to-office/shared-pptx@0.19.0
  - @json-to-office/core-pptx@0.19.0

## 0.18.0

### Patch Changes

- Updated dependencies [a079015]
- Updated dependencies [71faefc]
  - @json-to-office/core-pptx@0.18.0
  - @json-to-office/shared-pptx@0.18.0

## 0.16.0

### Patch Changes

- Updated dependencies [95cc7c4]
  - @json-to-office/shared@0.16.0
  - @json-to-office/core-pptx@0.16.0
  - @json-to-office/shared-pptx@0.16.0

## 0.13.0

### Patch Changes

- Updated dependencies [8744ad2]
  - @json-to-office/shared@0.13.0
  - @json-to-office/core-pptx@0.13.0
  - @json-to-office/shared-pptx@0.13.0

## 0.12.0

### Patch Changes

- Updated dependencies [c4a57aa]
  - @json-to-office/shared@0.12.0
  - @json-to-office/core-pptx@0.12.0
  - @json-to-office/shared-pptx@0.12.0

## 0.9.0

### Patch Changes

- Updated dependencies [58c0fb6]
  - @json-to-office/shared@0.9.0
  - @json-to-office/shared-pptx@0.9.0
  - @json-to-office/core-pptx@0.9.0

## 0.8.0

### Patch Changes

- Updated dependencies [b1af6ef]
  - @json-to-office/core-pptx@0.8.0
  - @json-to-office/shared-pptx@0.8.0
  - @json-to-office/shared@0.8.0

## 0.7.0

### Patch Changes

- Updated dependencies [c0bd927]
  - @json-to-office/shared@0.7.0
  - @json-to-office/core-pptx@0.7.0
  - @json-to-office/shared-pptx@0.7.0

## 0.3.0

### Patch Changes

- Updated dependencies [de674e0]
  - @json-to-office/shared-pptx@0.3.0
  - @json-to-office/core-pptx@0.3.0

## 0.2.0

### Minor Changes

- 1db99a3: Extract shared plugin infrastructure from core-docx into shared package and add plugin system for PPTX generation

### Patch Changes

- Updated dependencies [1db99a3]
  - @json-to-office/shared@0.2.0
  - @json-to-office/core-pptx@0.2.0
  - @json-to-office/shared-pptx@0.2.0
