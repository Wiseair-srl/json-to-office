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

No public type now references PptxGenJS.

**Fixed**

- Image `sizing` (`contain` / `cover`) and aspect-ratio auto-fill are resolved
  in one place with the intrinsic size, rather than partly in the writer.
- Post-render repairs — the SVG preview fix in particular — report into the
  same structured warning list as the rest of the pipeline on every path,
  including the plugin generator.
