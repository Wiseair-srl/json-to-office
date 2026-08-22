---
'@json-to-office/shared': minor
'@json-to-office/core-pptx': major
'@json-to-office/json-to-pptx': major
---

PPTX generation now compiles to a renderer-neutral intermediate representation

Presentations are compiled to `PptxIR` — plain, serialisable data describing a
finished deck in PowerPoint terms — and a renderer adapter turns that into
bytes. PptxGenJS is now one backend behind that seam rather than the pipeline
itself.

**Output is unchanged.** Every case in the parity corpus produces a
byte-identical package, checked against hashes recorded from the previous
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
