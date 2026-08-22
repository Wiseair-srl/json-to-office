---
'@json-to-office/core-docx': major
'@json-to-office/json-to-docx': major
---

DOCX generation now compiles to a renderer-neutral intermediate representation

Documents are compiled to `DocxIR` — plain, serialisable data describing a
finished document in Word terms — and a renderer adapter turns that into bytes.
docx.js is now one backend behind that seam rather than the pipeline itself,
which is the same shape the PPTX half already had.

**Output is unchanged.** Every case in the parity corpus produces an identical
package, part for part, checked against digests recorded from the previous
implementation (`src/__tests__/corpus-ir-parity.test.ts`).

**New**

- `renderer` option on every DOCX generation entry point and on the plugin
  generator: `'docxjs'` (default) or `'office-open'` (experimental, opt-in). An
  unsupported feature fails before any bytes are produced, with the feature name
  and the IR path that needed it.
- An experimental `@office-open/docx` backend, declared as an optional peer
  dependency. It covers paragraphs, styles, numbering, sections, columns,
  headers and footers, tables, floating tables, inline and floating images, SVG
  with a raster fallback, text boxes, text frames, footnotes, endnotes,
  comments, revisions, fields, bookmarks, cross-references and a table of
  contents with cached entries. Threaded or resolved comments are a verified gap
  — the backend's comment options carry neither a parent nor a resolved state —
  and are rejected up front rather than flattened.
- `DEFAULT_DOCX_RENDERER_ID`, `docxRendererIds()`, `isDocxRendererId()`,
  `UncompiledComponentError`, `DocxRendererId`.
- `renderer` on `createDocumentGenerator({...})` and on each
  `generateBuffer` / `generateFile` call, the latter overriding the former.
- `jto <format> generate --renderer <id>`, and a backend picker in the dev
  playground fed by a new `GET /api/<format>/renderers`. Both formats: the
  plumbing is shared, so `pptxgenjs` / `office-open` are selectable for PPTX
  too. An unsupported feature now answers `400` with the feature name and the
  path that needed it, where it used to be swallowed as a generic `500`.

**Breaking**

- `generateDocument()`, `generateDocumentFromJson()` and
  `generateDocumentFromFile()` — all of which returned a docx.js `Document` —
  are removed. Use `generateBufferFromJson` / `generateBufferWithWarnings` /
  `generateBufferFromFile`.
- `saveDocument(document, path)` and `generateFromConfig()` are removed. Use
  `generateAndSaveFromJson` / `generateAndSaveFromFile`, or write the buffer
  from `generateBufferFromJson` yourself.
- `DocumentGenerator.generate` is removed; the remaining members are buffer- and
  file-oriented.
- `DocumentGeneratorOptions.enableCache` is removed. The component render cache
  went with the writer layer — compiling to an IR holds no cross-document state,
  so there is nothing left to cache between documents — and keeping the option
  would have left a documented performance switch that did nothing.
- The component renderer exports and the text engine behind them
  (`parseTextWithDecorators` and the per-component render functions) are
  removed — they were the docx.js writer layer.
- `SectionProperties.headers` / `.footers` no longer name docx.js part types.

No public type now references docx.js.

**Fixed**

- Every document-scoped id — revisions, comments, notes, bookmarks, numbering —
  is allocated per compilation instead of in async-local storage, so two
  documents built in one process cannot reach each other's counters. The
  component render cache no longer has to bypass anything to stay correct.
- The theme's style set is compiled into the IR rather than built by a
  theme-to-docx.js adapter the renderer called itself, so `styles.xml` is
  described by the same data as the rest of the document.
- A threaded or resolved comment now records a required feature, so a backend
  that cannot write `commentsExtended.xml` refuses the document instead of
  silently flattening the thread.
- Every `wp:docPr` id the `office-open` backend writes is allocated per render
  rather than from that library's module-level counter, which made the same
  document come out differently on a second call and let two concurrent renders
  interleave. 38 of the 272 corpus cases were affected; none are now.
- A header or footer whose components are all `enabled: false` now breaks
  Word's link to the previous section instead of inheriting it. The author asked
  for no chrome and the section showed the previous section's, stale or
  confidential content included.
- The docx.js adapter reads all three chrome slots — `default`, `first` and
  `even` — where it read only `default` in two places: an SVG appearing solely
  in a first-page or even-page part shipped its own bytes labelled `image/png`
  as the raster fallback, and such a part was dropped from the section outright.
- Each image source is loaded once. The pre-pass fetched every image twice —
  once for its bytes and once for its dimensions — so a source whose response
  changes between the two embedded one image and sized it from another.
- `text-frames` and `custom-properties` are now recorded as required when a
  document uses them. Both adapters declared and emitted both, but nothing ever
  demanded them, so the capability check for a floating paragraph or a custom
  document property could not fire — a backend that declared them falsely would
  have dropped the content silently.
- The parity goldens record what each package _contains_ rather than a hash of
  the file. A golden over raw bytes also asserts that the deflate stream is
  identical, and deflate is the runtime's rather than this pipeline's, so a Node
  release with a different zlib fails every case at once while changing nothing
  about any document. Byte stability within one runtime is still asserted, by
  rendering twice, and CI now covers both ends of the advertised `>=20` range.
