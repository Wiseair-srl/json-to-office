# Office renderer IR

How authoring JSON becomes `.docx` / `.pptx` bytes, and where the seam between
"our semantics" and "somebody else's library" sits.

This is a contributor document. It is excluded from the published VitePress site
(see `srcExclude` in `docs/.vitepress/config.ts`).

## Status

| Area                                                                  | State                                                                                                                |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Shared renderer contract (`packages/shared/src/rendering/`)           | done                                                                                                                 |
| PptxIR + compiler + validation + debug snapshots                      | done                                                                                                                 |
| PptxGenJS adapter                                                     | done — the default, identical part for part to the previous implementation                                           |
| PPTX cutover: buffer/file APIs, plugin generator, native APIs removed | done                                                                                                                 |
| PPTX packaging split (generic vs backend)                             | done — repairs in `renderers/pptxgenjs/packaging.ts`, finalization in `core/finalizePackage.ts`, one shared zip pass |
| `office-open` PPTX adapter                                            | done — experimental, opt-in, declares a verified subset                                                              |
| DocxIR + compiler                                                     | done — including the style set, so the IR describes every part of the document                                       |
| docx.js adapter                                                       | done — the default, identical part for part across all 272 corpus cases                                              |
| DOCX cutover: buffer/file APIs, plugin generator, native APIs removed | done                                                                                                                 |
| `office-open` DOCX adapter                                            | done — experimental, opt-in; 265 of 272 corpus cases, the rest refused by name                                       |

## Why

Both pipelines used to hand author-derived values straight to a third-party
renderer: `docx` (docx.js) for Word, PptxGenJS for PowerPoint. Component code
therefore encoded two things at once — what the document _means_, and what one
particular library wants to be told. Backend quirks leaked into components,
backend repairs leaked into packaging, and backend types leaked out through the
public API.

The fix is a compile step. Each format gets its own intermediate
representation: plain, serialisable data that describes a finished document in
Office terms and nothing else. Renderers consume the IR; nothing upstream of the
IR knows a renderer exists.

## Layers

Two diagrams are published, each with an SVG source and a PNG rasterized from
it for the README — `docs/architecture.{svg,png}` for this pipeline and
`docs/document-model.{svg,png}` for the component tree the processor expands.
Edit the SVG, never the PNG, and regenerate with:

```bash
rsvg-convert -w 2160 docs/architecture.svg -o docs/architecture.png
rsvg-convert -w 2160 docs/document-model.svg -o docs/document-model.png
```

```text
author JSON
  → validation                     (schema + structural conflicts)
  → custom-component expansion     (plugin components → standard components)
  → standardDefinition             (normalised semantic authoring tree)
  → resolution                     (theme, defaults, fonts, structure, layout)
  → IR                             (DocxIR | PptxIR)
  → adapter                        (docx.js | PptxGenJS | office-open)
  → generic package finalization   (deterministic zip + core metadata)
  → bytes
```

`standardDefinition` is **not** the IR. It is the normalised _authoring_ tree:
still component-shaped, still carrying theme names, grid coordinates, markdown
text and inherited defaults. The IR is what is left after all of that is
resolved.

Compile to IR only after:

- schema validation
- custom-component expansion
- theme resolution (colour tokens → explicit colours)
- component defaults
- font resolution and substitution (including synthesized weight aliases)
- grid / layout resolution (grid cells → explicit transforms)
- markdown / decorator text parsing
- authoring-only component expansion

Worked examples:

| Authoring concept                        | IR result                                       |
| ---------------------------------------- | ----------------------------------------------- |
| DOCX `statistic`                         | paragraphs and runs                             |
| DOCX `visual`                            | an image resource + an image node               |
| PPTX grid cell `{column: 2, rowSpan: 2}` | an explicit EMU transform                       |
| Theme colour name `primary`              | `#1B4F72`                                       |
| PPTX placeholder content                 | a resolved slide element at a resolved position |

## Two IRs, not one

There is deliberately no universal `OfficeIR`.

A Word document is a flowing stream of blocks inside sections; a PowerPoint deck
is a set of absolutely-positioned shapes on fixed-size slides. Their unit
systems, their identity models and their notion of "a paragraph" do not
coincide. A shared supertype would be a union of two vocabularies with a
constant translation tax and no reader who wants both halves.

What the two formats genuinely share is the _contract shape_: how a renderer is
selected, how capabilities are declared, how unsupported features are reported.
That — and only that — lives in `packages/shared/src/rendering/`.

## Shared renderer contract

`packages/shared/src/rendering/`

- `types.ts` — `OfficeRenderer<TIR, TFeature, TId>`, `RenderOptions`,
  `OfficeFormat`, `assertNever`
- `diagnostics.ts` — `RendererDiagnostic`, `UnsupportedRendererFeatureError`
- `capabilities.ts` — `FeatureRequirementCollector`, `RendererRegistry`,
  `assertRendererSupports`
- `index.ts` — the public surface, re-exported from `@json-to-office/shared`
  and from `@json-to-office/shared/rendering`

A renderer is:

```ts
interface OfficeRenderer<TIR, TFeature extends string, TId extends string> {
  readonly id: TId;
  readonly format: 'docx' | 'pptx';
  readonly capabilities: ReadonlySet<TFeature>;
  render(document: TIR, options?: RenderOptions): Promise<Uint8Array>;
}
```

No format-specific feature name, IR node or unit belongs in `shared`.

## IR rules

Both IRs:

- are plain TypeScript data — no renderer classes, no functions, no instances
- use discriminated unions with a `kind` discriminant
- carry `schemaVersion: 1`
- use project-owned types and enums, never a backend's
- carry deterministic IDs (derived from position, not from a counter shared
  across generations)
- normalise colours to explicit values — no unresolved theme tokens
- name units in the property itself (`widthEmu`, `sizeHalfPoints`,
  `beforeTwips`)
- contain no backend-specific JSON, no backend workaround, no raw XML
- are testable with no renderer loaded
- snapshot stably, with binary resources represented by content hash

Binary resources are held as `Uint8Array` in the IR. They are _not_ base64'd to
make snapshots convenient — `debug.ts` replaces them with
`sha256:<hex>` + byte length when producing a snapshot.

### Units

| Where                           | Unit              |
| ------------------------------- | ----------------- |
| DOCX page & paragraph layout    | twips (1/1440 in) |
| DOCX font sizes                 | half-points       |
| DOCX drawings                   | EMU (1/914400 in) |
| PPTX coordinates and dimensions | EMU               |
| PPTX font sizes                 | points            |
| Timestamps stored in IR         | ISO 8601 strings  |

PPTX authoring is in inches; the compiler converts to EMU with
`Math.round(inches * 914400)`. The PptxGenJS adapter converts back by dividing,
which round-trips exactly because PptxGenJS applies the same rounding on the way
in.

## Capability model

The compiler records a `FeatureRequirement { feature, path }` every time it
emits a node that needs a backend capability. Before rendering:

1. the IR's required features are compared with the adapter's `capabilities`
2. every gap becomes an error-severity `RendererDiagnostic`
3. all gaps are thrown together as one `UnsupportedRendererFeatureError`
4. authoring warnings stay separate from renderer diagnostics
5. no adapter may silently ignore an IR node — unknown kinds hit `assertNever`

Feature unions are format-specific and live next to their IR
(`ir/features.ts`).

## Packaging ownership

Post-render work is split by _cause_, not by convenience.

**Generic format finalization** — valid for any backend, runs after the adapter:

- deterministic ZIP entry timestamps
- deterministic core metadata (`docProps/core.xml`) timestamps
- recursive normalisation of embedded Office packages (chart workbooks)
- canonical chart identifiers
- stable zip generation settings

**PptxGenJS-specific** — lives in `renderers/pptxgenjs/`:

- sentinel gradient / pattern fill replacement and `PendingXmlFill`
- the raw fill XML built solely for that workaround
- SVG preview repair for PptxGenJS output
- the `MEDIUM_STYLE_2_ACCENT_1` → `NO_STYLE_NO_GRID` table-style correction

**docx.js-specific** — lives in `renderers/docxjs/`; classified per repair with
evidence, never assumed generic.

`PendingXmlFill` and raw fill XML must never appear in PptxIR or in generic PPTX
types. PptxIR describes gradients and patterns _semantically_; each adapter
decides how to realise them.

### What "deterministic" covers

Determinism is a claim about two different things, and they hold at different
scopes:

| Claim                                  | Scope                                        |
| -------------------------------------- | -------------------------------------------- |
| Same input → same **package contents** | any supported runtime, any platform          |
| Same input → same **file bytes**       | one runtime build (same Node, same platform) |

Everything the pipeline decides is pinned: entry timestamps, core metadata
timestamps, relationship ids, drawing ids, embedded chart workbooks. What is
_not_ the pipeline's is the deflate stream — the container's compression comes
from the runtime's zlib, so a Node release that changes it changes every byte
of every package without changing a single document.

That is why the corpus goldens hash part content rather than the file
(`__tests__/fixtures/packageDigest.ts`): a golden over raw bytes asserts more
than this pipeline controls, and fails the entire corpus at once on a runtime
upgrade with nothing to distinguish that from a real regression. Byte stability
is still asserted, by rendering the same document twice in one process — which
is exactly the scope at which it holds. The `test` job runs both ends of the
advertised `>=22` engine range so neither claim is only theoretical.

If you need a package to be byte-identical across machines — an artefact hash,
a signature — pin the Node version alongside the input.

## Renderer selection

```ts
type DocxRendererId = 'docxjs' | 'office-open';
type PptxRendererId = 'pptxgenjs' | 'office-open';
```

Defaults are unchanged: `docxjs` for DOCX, `pptxgenjs` for PPTX. The
`office-open` backends are experimental, opt-in, and declare a subset; anything
outside that subset fails before bytes are produced.

```ts
await generateBufferFromJson(document, { renderer: 'office-open' });
```

Author JSON may instead select the backend with an optional root discriminator:

```json
{ "name": "pptx", "renderer": "office-open", "props": {}, "children": [] }
```

Omission selects `docxjs` / `pptxgenjs`. A generation option overrides the
document field. Generated schemas contain one branch per renderer, derived from
the canonical component schemas; compiler capability checking remains the final
gate for value-dependent and plugin-expanded requirements.

## API migration

Retained: `generateBufferFromJson`, `generateBufferFromFile`,
`generateBufferWithWarnings`, `generateAndSaveFromJson`,
`generateAndSaveFromFile`, plugin `generateBuffer` / `generateFile`,
`expandStandardDefinition`, and the validation/schema APIs.

Removed at cutover, because they exposed renderer objects:

- DOCX — `generateDocument`, `generateDocumentFromJson`,
  `generateDocumentFromFile`, `generateFromConfig`, `saveDocument(Document,…)`,
  plugin `generate()`, `DocumentGenerator` members returning docx.js objects
- PPTX — `generatePresentation(): Promise<PptxGenJS>`,
  `savePresentation(PptxGenJS,…)`, `PresentationGenerator` members exposing
  PptxGenJS

IR types stay internal to `core-docx` / `core-pptx` for this release; they are
not exported from `@json-to-office/json-to-docx` or
`@json-to-office/json-to-pptx`.

## Testing strategy

- **IR tests** — deterministic IDs, resolved units, resolved colours/fonts,
  resource deduplication, stable ordering, required-feature collection,
  invariant rejection, absence of renderer-native values.
- **Default-backend parity** — one recorded digest per corpus case, covering
  every part's name and uncompressed bytes and nothing about compression (see
  [What "deterministic" covers](#what-deterministic-covers)). Every intentional
  difference is documented; unexplained output changes are not accepted.
- **Cross-backend** — for the shared supported subset, assert required package
  parts, expected XML content, relationships, text/element counts, metadata,
  page/slide dimensions, tables, images, styles. Identical OOXML between
  different renderers is _not_ required.
- **API tests** — compile-time consumer fixtures proving buffer APIs expose no
  backend types, that renderer IDs are format-specific, that an unsupported id
  fails type checking, and that removed native APIs are gone.
- **Requirement tests** — that a construct records the feature it needs, and
  that the set of features nothing can require is exactly the vocabulary no
  lowering covers yet. Only an adapter's _claim_ is visible in its source, so a
  feature declared but never required is a check that cannot fire: the document
  renders and a backend that could not express it drops the content silently.

## Backend capabilities

### PPTX

The exact capability matrix below is generated from the registered adapters.
Run `pnpm generate:renderer-docs` after changing a feature or capability set.

<!-- BEGIN GENERATED PPTX RENDERER CAPABILITIES -->

| Feature                 | Note                                       | `pptxgenjs` | `office-open` |
| ----------------------- | ------------------------------------------ | ----------- | ------------- |
| `rich-text`             | Multiple formatted runs in one text body.  | yes         | yes           |
| `complex-bullet-glyphs` | Astral or multi-code-point bullet glyphs.  | —           | yes           |
| `text`                  | Text bodies and uniform runs.              | yes         | yes           |
| `shapes`                | Preset-geometry shapes.                    | yes         | yes           |
| `images`                | Raster and vector pictures.                | yes         | yes           |
| `svg`                   | SVG pictures.                              | yes         | —             |
| `image-crop`            | Picture crop and cover.                    | yes         | —             |
| `image-rounding`        | Rounded or circular picture masks.         | yes         | —             |
| `tables`                | Tables, rows and cells.                    | yes         | yes           |
| `table-merged-cells`    | Column and row spans.                      | yes         | —             |
| `table-insets`          | Cell padding written on table cells.       | yes         | —             |
| `table-rounded-corners` | Rounded table corners.                     | yes         | —             |
| `table-auto-page`       | Flow long tables onto more slides.         | yes         | —             |
| `charts`                | Native charts with embedded workbooks.     | yes         | yes           |
| `chart-bar-style`       | Bar gap and overlap.                       | yes         | yes           |
| `chart-pie-style`       | First-slice angle and doughnut hole.       | yes         | yes           |
| `chart-line-style`      | Line smoothing, width and symbols.         | yes         | yes           |
| `chart-radar-style`     | Radar chart style.                         | yes         | yes           |
| `chart-data-labels`     | Chart data-label content and position.     | yes         | yes           |
| `chart-data-border`     | Series and data-point outlines.            | yes         | yes           |
| `chart-axis-scale`      | Axis bounds, units and number format.      | yes         | yes           |
| `chart-axis-visibility` | Axis and axis-line visibility.             | yes         | yes           |
| `chart-axis-style`      | Axis label rotation and grid lines.        | yes         | yes           |
| `chart-text-style`      | Chart title, legend, axis and label fonts. | yes         | yes           |
| `solid-fills`           | Solid shape fills.                         | yes         | yes           |
| `gradient-fills`        | Gradient shape fills.                      | yes         | yes           |
| `pattern-fills`         | Pattern shape fills.                       | yes         | yes           |
| `image-fills`           | Images used as shape fills.                | —           | yes           |
| `lines`                 | Shape outlines and line elements.          | yes         | yes           |
| `shadows`               | Shape and text shadows.                    | yes         | yes           |
| `backgrounds`           | Solid or image slide backgrounds.          | yes         | yes           |
| `speaker-notes`         | Slide speaker notes.                       | yes         | yes           |
| `hidden-slides`         | Hidden-slide state.                        | yes         | yes           |
| `transitions`           | Slide transitions.                         | —           | yes           |
| `external-links`        | External URL hyperlinks.                   | yes         | yes           |
| `internal-links`        | Links to another slide.                    | yes         | yes           |
| `text-hyperlinks`       | Hyperlinks attached to text.               | yes         | yes           |
| `element-hyperlinks`    | Hyperlinks covering shapes or images.      | yes         | —             |
| `rotation`              | Shape, text-box and table rotation.        | yes         | yes           |
| `image-transform`       | Picture rotation and flips.                | yes         | —             |
| `flip-horizontal`       | Horizontal element flips.                  | yes         | yes           |
| `flip-vertical`         | Vertical element flips.                    | yes         | —             |
| `groups`                | Grouped elements sharing a transform.      | —           | yes           |
| `proofing-language`     | Per-run proofing language.                 | yes         | yes           |
| `rtl`                   | Right-to-left reading order.               | yes         | yes           |

<!-- END GENERATED PPTX RENDERER CAPABILITIES -->

The generated matrix is the adapters' declared surface. The table below keeps
backend-specific evidence and caveats, including APIs an adapter has not mapped.

| Feature                                      | `pptxgenjs`                                            | `office-open` (0.14.6; rows verified against 0.11.0, re-checked by the 0.14.6 corpus proof)                |
| -------------------------------------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| masters, layouts, placeholders               | yes                                                    | backend yes; adapter mapping not declared                                                                  |
| slides, slide size, theme                    | yes                                                    | yes                                                                                                        |
| text bodies, rich runs, paragraph properties | yes                                                    | yes (no `txBox="1"` is ever emitted — a text box renders as a shape)                                       |
| custom bullet glyphs                         | one BMP code point; complex glyphs are refused         | yes, including astral and multi-code-point glyphs                                                          |
| images (raster)                              | yes                                                    | yes                                                                                                        |
| SVG images                                   | yes (raster fallback repaired during packaging)        | **no** — `PictureOptions.type` excludes `svg`, and no code path creates an SVG media entry                 |
| preset shapes                                | yes                                                    | yes, but `preset` is a free-form string with no validation                                                 |
| transforms — position/size                   | yes                                                    | yes                                                                                                        |
| transforms — rotation                        | yes                                                    | shapes and groups only; `PictureOptions` has no `rotation`, which is why `image-transform` is not declared |
| transforms — flip                            | yes                                                    | `flipHorizontal` only; `flipVertical` is not on any pptx option type                                       |
| solid / gradient / pattern fills             | yes (gradient and pattern via a sentinel + XML splice) | yes, natively                                                                                              |
| image fills                                  | **no** — no shape image-fill API                       | yes                                                                                                        |
| lines, shadows                               | yes                                                    | yes                                                                                                        |
| tables — rows, cells, column widths          | yes                                                    | yes                                                                                                        |
| tables — border, fill                        | table-level options                                    | pushed onto every cell; the backend has no table-level form of either                                      |
| tables — merged cells                        | yes                                                    | **no** — `restart`/`continue` markers vs the IR's span counts                                              |
| tables — cell insets                         | `a:tcPr/@marL`                                         | **no** — `margins` writes `a:bodyPr` insets, which a reader ignores in a cell                              |
| tables — rounded corners, auto-pagination    | yes (corners via shapes drawn behind the table)        | **no** — no corner radius in OOXML, and nothing here flows a table onto a second slide                     |
| image crop / cover, rounding                 | yes                                                    | **no** — `PictureOptions` has no source rectangle and no geometry                                          |
| native charts                                | yes, with an embedded workbook                         | yes, except `bubble` — the adapter writes the workbook and cell references the backend omits (see below)   |
| hyperlinks (external + slide)                | yes                                                    | yes                                                                                                        |
| speaker notes, hidden slides                 | yes                                                    | yes                                                                                                        |
| transitions                                  | **no** API                                             | yes                                                                                                        |
| groups                                       | **no** API                                             | yes                                                                                                        |
| RTL                                          | deck-level                                             | deck- and paragraph-level; run-level `rightToLeft` is declared but never emitted                           |

### What the office-open PPTX adapter declares

Supported and mapped: text bodies and rich runs, paragraph properties, preset
shapes, images, solid/gradient/pattern/image fills, lines, shadows, tables with
their border and fill, backgrounds, speaker notes, hidden slides, transitions,
groups, external and slide hyperlinks, shape rotation, horizontal flip, proofing
language, RTL, the authored theme (`theme1.xml` fonts and colour scheme) and the
`company` document property.

Deliberately **not** declared, so a document using them fails before rendering
rather than losing content:

| Feature                   | Why                                                                                                                                                                                                               |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `svg`                     | `PictureOptions.type` excludes SVG and nothing creates an SVG media entry                                                                                                                                         |
| `image-transform`         | `PictureOptions` has no `rotation` and no flip; either would be discarded                                                                                                                                         |
| `image-crop`              | no source rectangle, so a cropped picture would be drawn whole into its frame                                                                                                                                     |
| `image-rounding`          | no geometry on a picture, so a circular image would come out rectangular                                                                                                                                          |
| `flip-vertical`           | no pptx option type carries it                                                                                                                                                                                    |
| `masters`, `placeholders` | the backend supports them; the mapping is not written, and an unmapped master would drop every template object                                                                                                    |
| `table-merged-cells`      | the backend marks merges as `restart`/`continue` on covered cells while the IR carries span counts                                                                                                                |
| `table-insets`            | `TableCellOptions.margins` writes the insets onto the cell's own `a:bodyPr`; a reader takes a cell's padding from `a:tcPr/@marL`, and a LibreOffice render moves not one point for a 40pt margin written that way |
| `table-rounded-corners`   | OOXML tables have no corner radius; the default backend fakes one with shapes drawn behind the table, and that technique is not in the IR                                                                         |
| `table-auto-page`         | nothing here flows a table onto a second slide, so an over-long table would run off the bottom of the first                                                                                                       |

Both backends are exercised over the same common-subset corpus in
`renderers/office-open/__tests__/cross-backend.test.ts`, which compares package
parts, slide dimensions, metadata, text content and element counts — not
byte-identical OOXML, which is not the goal between different renderers. A
LibreOffice conversion smoke test covers both, and skips itself when the tool
is absent.

`office-open` findings come from reading the shipped types and compiled source
and from generating, unzipping and rendering real files — not from its README.
Anything not proven by a test stays out of the adapter's capability set, so it
fails loudly instead of producing a deck with content missing.

### DOCX

The exact capability matrix below is generated from the registered adapters.
Run `pnpm generate:renderer-docs` after changing a feature or capability set.

<!-- BEGIN GENERATED DOCX RENDERER CAPABILITIES -->

| Feature              | Note                                           | `docxjs` | `office-open` |
| -------------------- | ---------------------------------------------- | -------- | ------------- |
| `paragraphs`         | Paragraphs and text runs.                      | yes      | yes           |
| `styles`             | Named paragraph and character styles.          | yes      | yes           |
| `numbering`          | Numbering definitions and numbered paragraphs. | yes      | yes           |
| `sections`           | Multiple sections and page setup.              | yes      | yes           |
| `columns`            | Multi-column sections.                         | yes      | yes           |
| `headers-footers`    | Default, first and even headers and footers.   | yes      | yes           |
| `tables`             | Tables, rows and cells.                        | yes      | yes           |
| `table-merged-cells` | Column spans and vertical merges.              | —        | —             |
| `floating-tables`    | Tables positioned outside text flow.           | yes      | yes           |
| `images`             | Inline pictures.                               | yes      | yes           |
| `floating-images`    | Anchored pictures with text wrapping.          | yes      | yes           |
| `svg-images`         | SVG pictures with raster fallbacks.            | yes      | yes           |
| `text-frames`        | Floating paragraph frames.                     | yes      | yes           |
| `text-boxes`         | Native shape text boxes.                       | yes      | yes           |
| `drawing-groups`     | Grouped DrawingML shapes and pictures.         | yes      | yes           |
| `charts`             | Native charts with embedded workbooks.         | yes      | yes           |
| `toc`                | Table-of-contents fields.                      | yes      | yes           |
| `cached-toc`         | Pre-rendered table-of-contents entries.        | yes      | yes           |
| `fields`             | Arbitrary Word fields.                         | yes      | yes           |
| `cached-fields`      | Cached field results.                          | —        | —             |
| `hyperlinks`         | Document hyperlinks.                           | yes      | yes           |
| `bookmarks`          | Named document bookmarks.                      | yes      | yes           |
| `cross-references`   | Links and fields targeting bookmarks.          | yes      | yes           |
| `comments`           | Document comments.                             | yes      | yes           |
| `comment-threads`    | Threaded and resolvable comments.              | yes      | —             |
| `footnotes`          | Footnotes.                                     | yes      | yes           |
| `endnotes`           | Endnotes.                                      | yes      | yes           |
| `revisions`          | Inserted and deleted content.                  | yes      | yes           |
| `breaks`             | Page, column and line breaks.                  | yes      | yes           |
| `shading`            | Paragraph and table shading.                   | —        | —             |
| `borders`            | Paragraph, table and page borders.             | yes      | yes           |
| `tab-stops`          | Paragraph tab stops.                           | yes      | yes           |
| `proofing-language`  | Per-run proofing language and no-proof.        | yes      | yes           |
| `custom-properties`  | Custom document properties.                    | yes      | yes           |
| `rtl`                | Right-to-left paragraph direction.             | —        | —             |

<!-- END GENERATED DOCX RENDERER CAPABILITIES -->

The generated matrix is the adapters' declared surface. The table below keeps
backend-specific evidence and caveats, including APIs an adapter has not mapped.

`@office-open/docx` 0.14.6 is not a thin wrapper — it is a second full
implementation with the same option vocabulary as docx.js, taken as plain JSON
rather than an object graph. That is why the adapter is a sibling of the
docx.js one rather than a translation layer on top of it.

| Feature                             | `docxjs`                                              | `office-open` (0.14.6; rows verified against 0.11.0, re-checked by the 0.14.6 corpus proof) |
| ----------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| paragraphs, runs, styles, numbering | yes                                                   | yes                                                                                         |
| sections, columns, headers, footers | yes                                                   | yes, including `first` and `even` parts                                                     |
| tables, floating tables             | yes                                                   | yes                                                                                         |
| merged cells                        | `verticalMerge` / `columnSpan`                        | the same two, spelled identically                                                           |
| inline and floating images          | yes                                                   | yes                                                                                         |
| SVG with a raster fallback          | yes                                                   | yes — `PictureOptions` has an `svg` type with a `fallback`, unlike its pptx sibling         |
| text boxes (`wps:wsp`), text frames | yes                                                   | yes                                                                                         |
| drawing groups (`wpg:wgp`)          | yes — `docx/shapes` `ShapeGroupRun`, loaded on demand | yes — a paragraph-level `wpgGroup` run taking shape, group and picture children             |
| footnotes, endnotes                 | yes                                                   | yes                                                                                         |
| native charts                       | yes — `docx/charts` `ChartRun`, with its own workbook | yes — look, cell references and workbook stated as options — see below                      |
| comments                            | yes                                                   | yes, but flat — see below                                                                   |
| revisions                           | one `w:ins`/`w:del` per run                           | a real wrapper element, so the id appears once per range                                    |
| fields                              | a run child per known instruction, plus `w:fldSimple` | `simpleField` takes any instruction with its cached result                                  |
| table of contents, cached entries   | title/level pairs, entry paragraphs built internally  | fully-built entry blocks, so this adapter writes them                                       |
| run size                            | half-points                                           | **points** — the backend doubles what it is given                                           |
| cell margins                        | `{marginUnitType, top, …}`                            | `{top: {size, type}, …}`                                                                    |
| `wp:docPr` ids                      | a **process-wide counter** — see below                | a **module-level counter** — see below                                                      |
| theme part (`theme1.xml`)           | `Document.theme`: name, colours, heading/body fonts   | Office's theme always, no option for another; the adapter splices the IR theme in           |

`@office-open/docx` numbers `wp:docPr` from `_docPropsIdGen`, a module-level
generator, whenever a drawing does not state an id. That is process-global: the
same document rendered twice came out with different ids, and two rendered at
once interleaved — 38 of the 272 corpus cases were byte-unstable because of it.
The adapter therefore states an id on every drawing, allocated per render in
document order. docx.js had the mirror-image problem until 9.8.0 — it
_duplicated_ ids (dolanmiu/docx#2719), and every drawing outside `document.xml`
was `id="1"` — and since 9.8.0 has this one: every drawing takes the next value
of a counter shared by the whole process (dolanmiu/docx#3521). Rather than state
an id on each drawing it builds (`altText.id` would take one), the docx.js
adapter renumbers the packaged file, one sequence across every part that can
hold a drawing: `document.xml` first, then headers and footers by number, then
footnotes, endnotes and comments (`utils/fixFloatingImageIds.ts`). Both are
covered by `__tests__/document-isolation.test.ts`, which renders a document
carrying a picture, a shape and a header image twice and concurrently, on both
backends, and asserts the ids unique across the package;
`__tests__/floating-docpr-uniqueness.test.ts` moves docx's counter between two
builds of a document with header and footer drawings and expects the same ids.

Deliberately **not** declared, so a document using them fails before rendering
rather than losing content:

| Feature                                                            | Why                                                                                                                                                       |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `comment-threads`                                                  | `CommentOptions` is `{id, author, initials, date, children}` — no parent, no resolved state, so a reply would flatten into an unrelated top-level comment |
| `table-merged-cells`, `cached-fields`, `shading`, `borders`, `rtl` | the vocabulary no lowering covers yet, so nothing can require them; both adapters leave them out so a declared set means "proven by a test"               |

`docxjs` withholds no capability of its own any more. `drawing-groups` and
`charts` were backend gaps — docx.js had no `wpg:wgp` and no chart primitive —
until docx 9.8.0 added `docx/shapes` and `docx/charts`. The adapter maps both
and imports each entry at render time rather than with the package, so a
consumer on an older docx still loads jto and gets a named error only from a
document that needs one (#478).

### Native charts

`@office-open/docx` 0.14 hands a chart run's `ChartSpaceOptions` to
`chartSpaceDesc` whole, as `@office-open/pptx` always did. Until 0.14 the docx
run forwarded eight of those fields and dropped the rest, and neither backend
had anywhere to put a series colour, so the adapters spliced the missing half
into the emitted parts after generation. Everything a chart needs beyond its
type and data is now asked for as options, stated by `chartLook` in
`chart-parts` (`@json-to-office/shared/rendering`) from each core's IR:

| Options                                                                                                                     | What they carry                                                                                                                                                       |
| --------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `nameFormula`, `valueFormula`, `categoryFormula`                                                                            | the cell each cached value comes from, so **Edit Data** opens the workbook's cells                                                                                    |
| `externalData`                                                                                                              | `rId1` and `autoUpdate: false`; on docx also the workbook's bytes and name                                                                                            |
| series `shapeProperties`, `marker`, `dataPoints`                                                                            | series colours (on the line and the marker for a line, radar or scatter series), line widths, borders, one `c:dPt` per slice of a pie or doughnut                     |
| `axes`                                                                                                                      | both axes, whole: position, title and its font, gridlines, ticks, line, label rotation and font, scale, number format                                                 |
| `grouping`, `gapWidth`, `overlap`, `firstSliceAngle`, `holeSize`, `markers`, `radarStyle`, `varyColors`, `autoTitleDeleted` | the plot                                                                                                                                                              |
| `title`, `textProperties`, `legendPosition`, `legendTextProperties`                                                         | the fonts on the title, the legend and the chart-wide default; where the legend sits                                                                                  |
| `date1904`, `lang`, `roundedCorners`, chart-area and legend `shapeProperties`                                               | Office's blanks, which 0.11 wrote unasked and 0.14 writes only when asked: without them a reader draws a chart with rounded corners, a border and a legend of its own |

`axes` goes whole because 0.14 fills in the axis ids per slot; 0.11 did not,
and a partial axis emitted literal `<undefined>` elements. A scatter chart's
axes are both value axes, X first, and its x values go in as numbers
(`numericCategories`), which a reader otherwise plots at 1, 2, 3….

One thing has no option: `c:scatterStyle`, which the backend writes from a
literal, `line`. `finishChartXml` replaces it, and fails the render if it finds
neither that literal nor the style it writes, so a changed spelling upstream
cannot turn it into a silent no-op.

Nothing in `@office-open/core` writes a workbook, so `chartWorkbookParts` builds
one. The two backends package it differently:

|                                     | `@office-open/docx`                                                                                                                 | `@office-open/pptx`                                                                              |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| workbook part                       | written by the backend from `externalData.data`: `word/embeddings/chart{N}.xlsx`, `N` the chart's place among the document's charts | written by the adapter: `ppt/embeddings/Microsoft_Excel_Worksheet{N}.xlsx`                       |
| chart relationship and content type | written by the backend                                                                                                              | written by the adapter (`chartParts.ts`); handed the bytes, the backend writes a dangling `r:id` |

The docx workbook name has to be unique per chart: the backend embeds one file
per name and points each chart at the name it was given, so two charts sharing
one would share the first one's numbers. The backend's own `chartN` cannot
serve, since it numbers header and footer charts in another order.

Emitted parts are still matched to IR nodes by content (`matchChartParts`),
which proves every emitted chart reached the package and hands
`finishChartXml` its input.

### Native charts on docx.js

docx 9.8.0 added `docx/charts`, whose `ChartRun` writes a whole chart: the
`c:chartSpace` part, its relationship and an embedded workbook, so nothing is
spliced in afterwards. `renderers/docxjs/charts.ts` maps the IR's chart run
onto its options. Parity with office-open is on content and placement — data,
series order and names, series colours, the title and axis titles, the legend
and its position, the extent and anchor, a chart area with no fill and no
border, and the face, size, weight and colour of every text element, whose
roles both backends take from `renderers/chartText.ts`.
`office-open/__tests__/chart-cross-backend.test.ts` pairs every corpus chart's
parts across the two backends and holds them to exactly that.

`ChartRun` takes no size on its chart-wide font, so every text element states
its own: tick labels and the legend at the chart text size, axis titles at
that size and weight, the title at 1.4 times it, bold. A text element added
later — data labels, a data table — has to state one too, or Word draws it at
9pt. A scatter point's x is its label read as a number; a label that is not one
is placed at its position, 1, 2, 3…, and the compiler warns once
(`ir/chartValues.ts`).

`docx/charts` is imported when `render()` starts rather than with the package
(`renderers/docxjs/docxSubpath.ts`). `docx` is a peer dependency and the entry
exists from 9.8.0 on, so a static import would fail the whole package for a
consumer on an older docx, chart or no chart. The import happens once per
process (about 6 ms), never rejects, and a failure surfaces — "needs docx 9.8.0
or later" — only when a document draws a chart. A caller of `buildDocument`
awaits `loadDocxCharts()` first.

The plot's own styling is what Word writes for a chart made with Insert Chart,
on both renderers. `ChartRun` defaults to it; `@office-open/docx` states none
of it, and each reader filled the gap its own way — cross ticks, dark axis
lines, no gridlines, a curved line, a doughnut with no hole — while two of the
gaps misdrew the data: a scatter chart's x values went in as text, which Word
and LibreOffice plot at 1, 2, 3…, and an untitled chart got a title invented
from its lone series' name, which also rescaled its value axis. So
`renderers/office-open/chartLook.ts` states the docx.js look for office-open:
per series through the backend, which passes each series object through whole
(`c:marker`, `c:smooth` 0, `c:invertIfNegative` 0), and the rest through the
shared `chartLook`, whose axis and plot options are opt-in, so a pptx chart
takes none it did not author.

| Area           | Both renderers                                                                                                                                                   |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Axes           | value-axis gridlines (scatter: Y only; radar: spokes and rings) and a category axis line, 0.75pt in a tint of the theme's Text 1; no tick marks (radar: crossed) |
| Bar spacing    | `gapWidth`/`overlap` 219/−27 on a column chart, 182/0 on a bar chart, whose categories run up the left                                                           |
| Pie, doughnut  | `firstSliceAng` 0, a doughnut's `holeSize` 50, 1.5pt slice borders in the theme's Background 1                                                                   |
| Lines          | 2.25pt, straight (`c:smooth` 0), round caps and joins; circle markers, size 5                                                                                    |
| Radar          | `radarStyle="marker"`                                                                                                                                            |
| Scatter        | `scatterStyle="lineMarker"`, x as a number (`numRef`, and numbers in the workbook's column A), X axis at the bottom                                              |
| Untitled chart | `autoTitleDeleted` 1                                                                                                                                             |

`office-open/__tests__/chart-cross-backend.test.ts` holds every corpus chart
to the same axes, gridlines, ticks, lines, gaps, markers, borders and x values
on both backends, and Word and LibreOffice draw them pixel for pixel the same
(the recorded difference below has the measurement). What still differs draws
nothing:

| Area        | `docxjs`                                                               | `office-open`              |
| ----------- | ---------------------------------------------------------------------- | -------------------------- |
| Data labels | an explicit `c:dLbls`, every label off                                 | none                       |
| Workbook    | docx.js's own `Microsoft_Excel_Worksheet{N}.xlsx`, with shared strings | jto's `chart{N}.xlsx`      |
| Alt text    | described from the data when none is authored                          | none when none is authored |

A chart in a header or footer draws on both renderers
(`chart/in-header-and-footer`). `@office-open/docx` 0.11 filled in chart
relationship ids in `word/document.xml` only, which left such a chart an
`r:id="{chart:…}"` placeholder: Word would not open the file and LibreOffice
drew an empty object (#485). 0.14 gives each header and footer part its own
relationship. It still also writes one unreferenced chart relationship per such
chart on `document.xml.rels`, which no reader follows.

### Chart styling

`charts` says a backend can draw a chart from data. It says nothing about the
options the chart was _styled_ with, and one coarse feature let office-open
accept a chart, draw it, and drop half of them — an ignored `valAxisMaxVal`
rescales a chart with nothing in the file to say so. Ten finer capabilities sit
beside it, each required by the compiler **only when the matching prop was
authored**, at that prop's own path.

Keyed off the authored props rather than the compiled IR on purpose:
`compileChartLabelFont` falls back to the theme body font when a weight is
authored without a face, so a compiled font object can hold a family the author
never wrote.

| Capability              | Reaches the file by                                                     |
| ----------------------- | ----------------------------------------------------------------------- |
| `chart-bar-style`       | forwarded — `gapWidth`, `overlap`                                       |
| `chart-pie-style`       | forwarded — `holeSize`, `firstSliceAngle`                               |
| `chart-data-labels`     | forwarded — per-series `dataLabels`, all six flags written explicitly   |
| `chart-line-style`      | forwarded `smooth`/`marker`; `lineSize` stated on `c:ser/c:spPr/a:ln`   |
| `chart-data-border`     | stated — an `a:ln` beside the fill, or on each `c:dPt` of a pie         |
| `chart-radar-style`     | stated — `c:radarStyle`                                                 |
| `chart-axis-scale`      | stated — `c:scaling` bounds, `c:majorUnit`, `c:numFmt`                  |
| `chart-axis-visibility` | stated — `c:delete`, and an `a:noFill` line                             |
| `chart-axis-style`      | stated — `c:majorGridlines`, label rotation                             |
| `chart-text-style`      | stated — `a:defRPr` in the title, legend, data labels and axis `c:txPr` |

Until `@office-open` 0.14 all but the first three were spliced into the
emitted part, since `AxisOptions` could not be passed without axis ids the
adapter could not allocate. Every one is an option now (`chartLook`), and the
backend writes each axis's children in the order CT_CatAx and CT_ValAx fix.

`pptxgenjs` declares all ten and already forwarded every one of these props, so
the split cost no deck that rendered before. Only `bubble` on office-open stays
refused, for the reason above.

Each core keeps its own packaging: `word/charts` and `word/embeddings` with
adm-zip on one side, `ppt/charts` and `ppt/embeddings` with jszip on the other.
The pptx workbook is named `Microsoft_Excel_Worksheet{N}.xlsx` because that is
what pptxgenjs writes and what `canonicalizeChartIds` renumbers — which is also
why the packaging has to run _before_ finalization rather than after.

The chart run also has the `wp:docPr` problem described above, and the same
cure: the adapter states an id on every chart drawing, because an unnamed one is
numbered from the process-global `_docPropsIdGen` and made two renders of one
document differ.

### Native visuals

A `visual` is normally rasterized: it becomes a one-slide PPTX, LibreOffice
draws it, and the PNG is embedded as an `image` — all of it before the compiler
sees the tree. `renderMode: "native"` takes a different path entirely. The
component survives desugaring, the compiler lowers it to a
`DocxIrDrawingGroupRun`, and either adapter emits one `wpg:wgp` — office-open
through its `wpgGroup` run, docx.js through `docx/shapes` (see below). No PPTX,
no rasterizer request, no pre-pass counter moves.

The IR node is backend-neutral by construction: it says what is drawn and where
(EMU frames in the group's own child coordinate space, resolved colours,
registered picture resources), never how. The gate is the ordinary capability
one: both adapters declare `drawing-groups`, and a backend that did not would
refuse the document rather than drop the graphic.

Native mode is strict on purpose. Its element model — `text`, `shape`, `image`
— is narrower than the PPTX slide-content union, and every native schema is
`additionalProperties: false`, so a gradient fill or a chart element is a
validation error instead of a silent omission. `collectDocxRendererErrors`
carries the rule a schema cannot, under either renderer: an element kind with
no native form is reported at `props/elements/N/name`. It looks no further into
a visual, whose elements are slide or drawing elements and never docx
components, so a raster visual's pptx `chart` element is not taken for the
docx `chart` component.

Four native cases are in the shared corpus (`fixtures/corpus-drawings.ts`): a
canvas with a background and one without, pictures cropped and fitted, and a
group floating with a caption, in a table cell and in a header. Their goldens
pin the docx.js bytes, and the cross-backend comparison holds them to
office-open's text, counts and extents. `__tests__/native-visual.test.ts`
asserts, on both backends, the emitted DrawingML, the absence of any rasterizer
contact and byte determinism across sequential and concurrent renders.
`libreoffice-smoke.test.ts` opens one from each backend for real.

Both `visual.props` shapes carry an `$id` so the JSON-Schema export hoists them
into definitions rather than inlining them at every position a component can
appear. That is not tidiness: `visual` is the largest props schema in the
registry, and two of them inlined pushed the exported `ComponentDefinition`
deep enough that Ajv overflowed compiling it — for an ordinary _raster_ visual
in a section header, nothing to do with native mode.

The recursive component definition is named **per renderer** —
`docxComponentDefinitionName` gives `ComponentDefinition_docxjs` and
`ComponentDefinition_office-open`. Both branches used to embed it under one
shared `$id`, and the export pass keys `definitions` by `$id` with a plain
overwrite, so the last branch walked — office-open — answered for both, and the
docxjs definition never reached the file. Every position reached through the
definition (section `props.header`/`props.footer`, table
`props.columns[].cells[].content`, `componentDefaults.section.header`) got the
office-open view whatever the document's renderer said, in both directions: a
`docxjs` threaded comment in a header was refused, and a `renderMode: "native"`
visual under `docxjs` was accepted. Positions reached through a branch's own
narrowed child union — a direct child of `docx` or of `section` — were always
right, which is what made it look local: the same `visual` was refused in a
section body and accepted in that section's header.

Naming the definition per renderer means the `$ref` fix-up passes cannot assume
one name, so `schemas/export.ts` and `@json-to-office/shared`'s
`schema-utils.ts` resolve a bare reference against whatever was actually
hoisted, falling back to their `rootDefinitionName` only for a reference that
names nothing. `componentDefaults` needs one more step: it is shared with the
theme schema, so it is built from the _static_ section props and carries an
untyped placeholder instead of a live recursive ref.
`docxPropsSchemaForRenderer` names those placeholders while the renderer is
still known and the schema is still that renderer's private clone.

Naming a placeholder is now the only way one gets a `$ref`. The fix-up passes
used to rewrite _every_ untyped array item to their root definition name
whether or not such a definition existed, and the theme schema is what exposed
that as a bug: it embeds the same `componentDefaults`, so it inherited a
`#/definitions/ComponentDefinition` it had no way to carry — a component union
is per renderer, and a theme names no renderer. Ajv refuses to compile a schema
containing an unresolvable reference, so the shipped `theme.schema.json` failed
on itself before it looked at any theme. An item with nothing to point at now
stays untyped. `jto docx validate --type theme` never went through it — that
path validates against TypeBox — so this only ever hit `--schema` and external
consumers of the published file.

The cost is one more full definition: the exported `schemas/document.schema.json`
goes from 8.7 MB to 12.2 MB pretty-printed, and Ajv's compile of it from ~3.1 s
to ~4.3 s. Nesting depth — the number that decides whether Ajv overflows V8's
stack — is unchanged at 39, because the second definition sits beside the first
rather than inside it. `__tests__/renderer-definition-split.test.ts` pins the
split itself; `jto-cli`'s `json-validator.test.ts` pins both symptoms
end-to-end through a compiled Ajv validator, and that the theme schema compiles
at all.

Both backends are exercised over the **whole** corpus in
`renderers/office-open/__tests__/cross-backend.test.ts`: 265 cases are compared
on text, structural element counts, media parts and note/comment counts, and the
7 that use comment threads are asserted to be refused by feature name. Identical
OOXML between different renderers is not the goal and is not asserted. A
LibreOffice conversion smoke test covers both and skips itself when the tool is
absent.

Where the two libraries disagree about a unit or a field name, the difference is
pinned in `renderers/office-open/__tests__/emit.test.ts` rather than left to the
type checker: the adapter builds plain option bags on purpose, because typing
them against `@office-open/docx` would put a backend's types into this package's
published `.d.ts`.

`office-open` findings come from reading the shipped types and compiled source
and from generating, unzipping and rendering real files — not from its README.
Anything not proven by a test stays out of the adapter's capability set, so it
fails loudly instead of producing a document with content missing.

### Native visuals on docx.js

docx 9.8.0's `docx/shapes` draws the group (#478). The adapter uses
`ShapeGroupRun` rather than `ShapeCanvasRun`: a canvas's children keep their
own size, so a canvas authored at one size and placed at another cannot be
expressed, and a canvas writes the diagram twice (`wpc:wpc` with a `wpg:wgp`
fallback in `mc:AlternateContent`, 2497 bytes against 896 for one child). A
group scales its children onto its extent and writes one bare `wpg:wgp`, as
office-open does. `renderers/docxjs/drawingGroup.ts` builds the option bag and
`presetShapes.ts` maps the IR's OOXML preset and dash names onto docx's
readable ones: 187 presets and 11 dashes, each map total and checked at compile
time, and each throwing on a name it does not know, where docx would write an
empty `<a:prstDash/>` that draws solid.

`docx/shapes` is imported when a render meets a drawing group rather than with
the package (`docxSubpath.ts`): the entry does not exist before docx 9.8.0, and
it is 186 KB minified and costs about 13 ms and 1.5 MB of heap to load. A
document without a group never loads it, never has its strings walked and never
goes through the repair below, which is why no existing golden moved.

`ShapeGroupRun` has no child-space option: `a:chOff`/`a:chExt` are the union of
the children's unrotated boxes. The IR's child space is the whole canvas, so
when the children do not reach every edge — any visual without a background —
the bottom-most child is an invisible rectangle the size of the canvas, marked
decorative so screen readers skip it: the pad upstream's own canvas fallback
uses. With a background the union already is the canvas, and the child list
matches office-open's. The compiler rounds each offset and extent on its own,
so an edge can be overshot by an EMU; within 2 EMU that still counts as the
edge. A child that really reaches past the canvas keeps the authored scale: the
group's extent grows by the overflow, where office-open draws it outside a
frame of the placed size. The alternative, rewriting `a:chOff`, `a:chExt`,
`a:ext` and `wp:extent` to office-open's values after packing, is more brittle
and is not built. The corpus keeps every child inside its canvas.

Three things docx writes cannot be stated through its options, so a post-pack
pass, `drawingGroupRepair.ts`, puts them right, only for a package whose IR
holds a group:

- **Child ids.** Every `cNvPr` in a group comes from docx's process-wide drawing
  counter. They are renumbered in one sequence after the highest drawing id
  anywhere else in the package, walking the parts in `fixFloatingImageIds`'s
  order, and every part holding a group is rewritten, for that pass's reason.
- **Rotation.** docx writes `rot` as degrees × 60000 unrounded (`7.123456°`
  becomes `rot="427407.36"`, which `ST_Angle` forbids). It is rounded and not
  wrapped, exactly as office-open writes it, so `-30°` stays `-1800000`.
- **Markers.** With no truthy alt text docx describes the group from its
  children's names, and it cannot write `wps:cNvSpPr txBox="1"`. The adapter
  passes a marker description, and a marker title on a text box's `wps:cNvPr`;
  the repair drops the first and turns the second into `txBox`. The markers are
  chosen per document so that no string in it contains one, and a marker that
  survives the repair throws, naming the part.

Where docx's defaults differ from OOXML's the adapter states OOXML's: text
anchored at the top rather than centred, no fill, and no line rather than a
black 1pt one. An outline with no colour strokes nothing, and one with a colour
and no width is a hairline, as office-open draws them. A line width or text
inset past 1584pt — docx's range and `ST_LineWidth`'s maximum — is clamped
rather than refused, since the schema sets no maximum for either. A run's own
underline colour, which only a native visual's text states, reaches docx.js
runs too.

What still differs from office-open's output: docx.js computes
`wp:effectExtent` for rotated and line shapes where office-open writes zeros;
`anchor="t"`, `a:noFill` and `a:ln/a:noFill` are stated; a colour-only outline
writes `w="0"` rather than no `w`; a colourless outline writes `a:ln/a:noFill`
rather than an `a:ln` with no fill; `line`-family presets use `wps:cNvCnPr`; a
picture with no crop writes an empty `<a:srcRect/>`; group-child ids follow the
last `wp:docPr` rather than their own group's; the pad carries
`adec:decorative`; insets and line widths past 1584pt are clamped; and an
overflowing child grows the frame.

LibreOffice draws `examples/native-visual.docx.json` and three of the four
corpus cases pixel-identically on both backends. On the canvas without a
background it sizes office-open's group to its children, so that drawing sits
above and left of where its canvas puts it; the docx.js pad keeps the canvas,
and the same pad spliced into office-open's output makes the two identical.

### Packaging notes for `@office-open/*`

ESM-only, no `require` condition, no peer dependencies, no install scripts, no
native code (7.4 MB across 6 packages) — which is what makes them cheap enough
to be ordinary `dependencies` of the two cores rather than optional peers.

They were optional peers until an integration run showed what that cost: under
`npx`, where nobody has a project to `pnpm add` into, `office-open` was
advertised by `jto_info`, `jto_discover` and `jto_validate` and installed by
none of them, so the only way to discover it could not run was to fail a render
— and with it the `visual` component's `renderMode: "native"`, which was then
documented as needing that backend. Installed by default, and reported with
`available` beside the id, both halves of that are gone.

Three constraints matter:

- `@office-open/core` uses a top-level `await import('node:zlib')`, so anything
  bundling it cannot be emitted as CJS.
- Both adapters are typed against the option types `@office-open/docx` and
  `@office-open/pptx` export (`DocumentOptions`, `PresentationOptions` and what
  they hold), so a renamed or moved option fails the build rather than reaching
  the backend as a key it skips. `@office-open/core`, where many of those types
  live, is only a devDependency of the cores and never named in their
  declarations: a pnpm consumer could not resolve it.
- The pin is exact, `0.14.6`, and each adapter refuses any other installed
  version when it loads (`OFFICE_OPEN_VERSION`, an error named
  `RendererBackendVersionError`). The options are data: on the raw move from
  0.11, 92 of 308 corpus documents failed to render and 216 lost content
  without an error. The version is read the way `import` resolves the package,
  since its exports map has no `require` condition
  (`@json-to-office/shared/rendering/node`).

`0.14.6` is the release, not upstream `main`, which already carries unreleased
changes (a reproducible-output scope, pptx media references among them) that
will move output again at the next bump.

`@office-open/docx` fills whatever it is not given with Word's own defaults,
where docx.js writes the neutral value, so the DOCX adapter states the neutral
value itself. Two of those defaults moved text. `w:docDefaults` gets Word 365's
— theme fonts at 11pt, kerning, ligatures, en-US/zh-CN/ar-SA, 8pt after and
1.16 lines — for each half not passed as `null`
(`renderers/office-open/styles.ts`), and every section's `w:docGrid` gets the
15.6pt line grid of Word's Chinese template (`w:type="lines"`, pitch 312)
field by field, so the adapter states all three
(`renderers/office-open/emit.ts`). Through LibreOffice 26.2 the grid
set `examples/invoice.docx.json`'s body 4.65pt lower at its first line and
45.7pt lower by its table, and the kerning moved words sideways; the spacing
default reached nothing there, since the invoice's `Normal` states its own.
With both stated, and the running head at the same distance, all 318 words of
the invoice land where docx.js puts them.
`office-open/__tests__/cross-backend.test.ts` holds the document defaults and
every section's grid equal across the backends, which every corpus case the
second backend draws failed before.
The same grid crowded a client report's KPI in the preview (#468):
LibreOffice 26.2 set a delta wrapped under its figure with no leading, its
glyphs touching the figure's where they clear them by 2.7pt without the grid,
while 24.2 spaces such lines at the grid's pitch, as Word does, 6 to 12pt
further apart than docx.js. `blocks/__tests__/json-blocks.test.ts` measures
that gap through LibreOffice and holds it equal on both backends.
Word's built-in styles in `styles.xml` and its 2013 compatibility settings are
written on this backend only and are left alone. jto refers to none of them; the
one that applies unasked, the default table style's 108-twip cell margins,
reaches only a cell that states no margins of its own, which in the corpus is
eight cells of `tables/ragged-and-empty-cells`. Some of those styles — Heading
7–9, Quote, Intense Quote, Intense Reference and the heading, title, subtitle
and quote character styles — and the first run of every contents field name
theme colours and fonts, so they follow the theme part, which `themePart.ts`
replaces with the document's own (see Recorded output differences). The
complex-script twins of a size or bold (`w:szCs`, `w:bCs`), which docx.js adds
to every run and style and this backend does not, are not stated yet.

## Recorded output differences

Everything else is identical part for part, checked case by case against the pre-IR
implementation. These are the deliberate exceptions.

### PPTX

| Change                                                                                                                                                                                                                                                                                                                                                                                | Why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A text box with a named `style` and no coordinates lands in a band for that style rather than at (0, 0).                                                                                                                                                                                                                                                                              | Named styles carried type and no position, and every positionless element resolved to the origin — so a `title` and a `subtitle` on one slide drew on top of each other in the top-left corner, which is the shape both shipped starters had. Bands are fractions of the slide extent, so they hold at any aspect. Each axis is decided on its own: a stated `x` still wins for `x`. An unstyled text box keeps the origin. Two positionless boxes that still overlap — two of the same style — are reported as `TEXT_OVERLAP_UNPOSITIONED` rather than moved; moving one is a layout engine's job (#220).                                                |
| A table draws a border and sets its first row apart.                                                                                                                                                                                                                                                                                                                                  | With no `componentDefaults.table` in any bundled theme, a table was bare text in columns: no rule anywhere, nothing marking the header. The themes now state a border and `headerRow: true`. Every part of the header treatment yields to something the author said — a cell's own fill or weight, or a table-wide `fill`/`color`. Deliberately no `margin`: cell insets are a capability `office-open` refuses, and a default every table inherited would have turned a working backend into one that fails every table.                                                                                                                                 |
| A number in `[20, 100)` used as a table `x`/`y`/`w`/`h` now means inches, as it does everywhere else.                                                                                                                                                                                                                                                                                 | The backend's table path used a different inch/EMU threshold (20) from the rest of its API (100), so the same authored number meant different things depending on which component it was on. The compiler applies one rule. The affected range is meaningless under either reading (20–100 inches, or 20–100 EMU ≈ 0.0001").                                                                                                                                                                                                                                                                                                                              |
| `underline: false` no longer underlines.                                                                                                                                                                                                                                                                                                                                              | The pre-IR writer treated any boolean as "underline", so `false` turned it on.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `bullet: { type: 'bullet' }` now produces a bullet.                                                                                                                                                                                                                                                                                                                                   | The object form was passed through in a shape the backend ignored, so an authored bullet silently did nothing. The boolean form always worked.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `bullet: false` no longer produces a bullet.                                                                                                                                                                                                                                                                                                                                          | Every boolean lowered to an enabled bullet, so an explicit "no bullet" could not override one inherited from a style. `{ type: 'number' }` with no other field now numbers instead of clearing the bullet. A single-BMP custom glyph reaches both backends; PptxGenJS refuses astral and multi-code-point glyphs instead of silently substituting `•`.                                                                                                                                                                                                                                                                                                    |
| A four-value `margin` keeps the schema's `[top, right, bottom, left]` order.                                                                                                                                                                                                                                                                                                          | PptxGenJS's text path reads those four numbers as `[left, right, bottom, top]`, disagreeing with its own table path, and the office-open adapter read them as `[left, top, right, bottom]`. Both are corrected in the adapter; a symmetric margin is unaffected, which is why nothing in the corpus moved.                                                                                                                                                                                                                                                                                                                                                |
| A rounded table positioned with percentages now gets its rounded backdrop.                                                                                                                                                                                                                                                                                                            | The backdrop was drawn only when `x` and `y` happened to be plain numbers, so a percentage-positioned rounded table came out square. The IR always carries a resolved absolute origin.                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Slide templates, placeholders and masters no longer exist; a `group` flattens into slide elements.                                                                                                                                                                                                                                                                                    | JSON blocks (#340) replaced the template tier. A definition expands into a transparent `group` whose children the layout pass has already resolved to absolute inches — frames, row/column distribution and nested grids — so the compiler draws them in order as slide elements and emits no master. `masters` and `placeholders` left the feature vocabulary, the IR and both adapters; the corpus template cases became block cases with new goldens, and the three shipped decks invoke their chrome as a block on every slide that used a template.                                                                                                  |
| A deck that names no theme, or a theme that does not exist, renders on `consulting`, and the `default` theme is gone (65 cases moved: every corpus deck that names no theme, `block/*` through `theme/shared-foundation`).                                                                                                                                                            | #331. The stock Office look — blue, orange and green accents, Arial throughout, 18pt `#333333` text — was what a deck got when nobody chose one, and it is the look the design programme replaces. `consulting` is the house theme and the twin of the DOCX default, so a theme-less deck and a theme-less report now match. `DEFAULT_PPTX_THEME` is the consulting theme and `getPptxTheme` falls back to it; `dark` and `minimal` stay as explicit alternates. No corpus case names a theme it did not name before, so every case that moved moved for the default alone; tests that pin a component's behaviour on a plain palette now name `minimal`. |
| A chart's axis titles state a size, face and colour (1 case moved: `chart/configured`).                                                                                                                                                                                                                                                                                               | #423. PptxGenJS writes an axis title's `sz` only when handed `catAxisTitleFontSize`/`valAxisTitleFontSize`, and nothing passed them, so every axis title drew at PowerPoint's own axis-title default — far larger than the tick labels, which also moved the value-axis title. The title now follows its axis' tick labels (size, face, colour), with the theme body font and 12pt as fallbacks, and `catAxisTitle*`/`valAxisTitle*` (`FontSize`, `FontFace`, `Color`, `Rotate`) override it. The office-open adapter writes the same font into the `c:title` it splices.                                                                                 |
| A radial gradient ships as a PNG on PptxGenJS (`shape/gradient-radial` moved).                                                                                                                                                                                                                                                                                                        | #423. `<a:path path="circle">` means two things: LibreOffice draws a circle about the focus with the last stop half the diagonal out, PowerPoint an ellipse in shape-relative space, so a corner-focus slide background looked different on every slide. `radialRaster.ts` paints the LibreOffice geometry — the one the preview and `pptx/text-contrast` assume — in plain JavaScript and encodes it with pako, so the bytes match on every CPU. A shape gets a stretched `a:blipFill`, keeping its geometry, text and outline; a bare full-bleed radial backdrop becomes the slide background picture. Linear gradients stay vector.                    |
| `@office-open/pptx` 0.11.0 → 0.14.6: every `office-open` deck moved (all 55), in thirteen classes of package change; no `pptxgenjs` deck moved, with pptxgenjs 3.12.0 → 4.0.1 beside it. A shape's outline takes its authored colour (`shape/fills-and-lines`, `consulting-deck-blocks`), and struck-through text opens in PowerPoint (`text/rich-runs`, `text/runs-inherit-strike`). | As on DOCX, 0.14 renamed most of the option vocabulary, and the adapter is migrated and typed against the options `@office-open/pptx` exports. Typing them found two adapter defects the untyped options had hidden: the outline colour went in as `fill`, which `OutlineOptions` never read, and strike as `single`, which is no `ST_TextStrikeType` value and which PowerPoint hung on. The classes and the proof follow the table.                                                                                                                                                                                                                     |

Every `office-open` deck moved with `@office-open/pptx` 0.11.0 → 0.14.6, and
the move was checked the way the DOCX one was: the 55 decks this backend writes
for the corpus, the gallery and the examples were dumped before and after,
every difference falls in one of thirteen classes, normalising those leaves
nothing, and leaving out any one of them leaves residue. The 70 `pptxgenjs`
decks are byte-identical. With the number of decks each touches:

- The XML declaration and the root element share a line (55),
  `viewProps.xml` drops `autoAdjust`, `varScale` and the notes text view (55),
  masters no longer state an all-off `p:hf` (55), slides no longer state the
  default `p:clrMapOvr` (55), and picture blips drop the default
  `cstate="none"` (6).
- Relationship ids, relationships, content-type entries and ZIP parts come in
  another order (3).
- In the 7 charted decks a true CT_Boolean is written `val="1"` rather than
  bare; the doughnut loses an empty `c:spPr` per series (1), and a chart's frame
  stops repeating its title as `p:cNvPr/@title` (1, `chart/configured`).
- The two fixes: an outline's `a:solidFill` (2) and `sngStrike` where `single`
  was written (2).

One class was undone rather than recorded. 0.11 wrote Arial as the font of
every character or number bullet unasked, and 0.14 writes none, which left the
marker in the text's face: PowerPoint drew the bullets of
`text/bullet-object-form` and `consulting-deck-blocks` a little heavier. The
adapter now states Arial, the face PowerPoint gives a bullet it adds, and those
three slides are the 0.11 bytes again.

In LibreOffice 26.2 the 55 decks render pixel for pixel as before, 64 slides,
but where the two fixes draw: the outlines of `shape/fills-and-lines` and the
rules of `consulting-deck-blocks`, and the strike through `text/rich-runs` and
`text/runs-inherit-strike`, which LibreOffice skipped as an unknown value. In PowerPoint 16.113 sixteen decks exercising the classes —
the six charted corpus decks, bullets, outlines, pictures, links and notes,
`consulting-deck-blocks` — render as before but for the same outlines and
rules; a chart slide can differ by a few hundred antialiased pixels between
two renders of the same bytes, and the differences on `consulting-deck-blocks`'
two chart slides beyond its rule are that. The two struck-through decks open
in PowerPoint, which hung on the 0.11 ones.

Image `sizing` and aspect-ratio auto-fill moved into a pre-pass rather than
being split between the writer and the backend, but the results are unchanged —
the corpus cases for `contain`, `cover` and the auto-fill were recorded from the
old implementation and still pass.

`transition` is lowered now, so it is no longer authored-but-ignored. It reaches
the package through `office-open`, and PptxGenJS — which has no transition API —
refuses a deck that asks for one rather than dropping it. A `transition` of
`none` lowers to nothing, because OOXML says "no transition" by omitting the
element, so it asks nothing of either backend.

The corpus image fixture is a real PNG now (9 cases moved: `image/aspect-from-width`,
`image/aspect-from-height`, `image/contain`, `image/cover`, `image/contain-without-box`,
`image/rounding-rotate`, `image/rotated`, `image/url-free-aspect`, `link/on-image`). The 4x2
PNG it used had wrong CRCs and pixel data that would not inflate, so PowerPoint drew its
broken-picture box; the replacement has the same pixel size, so only the media bytes differ.
Compilation now refuses such bytes as `ASSET_UNREADABLE`.

#### How the PPTX ones were found

A corpus built feature by feature does not reach inputs where a prop only
matters in combination with another, or where a default only shows up because
something else is absent. Nine such inputs were losing content or shifting
layout: template objects rendered without their slide's context, so
`{PAGE_NUMBER}` shipped as literal braces and the deck language never reached
them; component-level `underline` and `strike` never reached the runs of a
rich-text body; a template's `margin` was dropped, silently resizing any
unconstrained table on that master; a body-level hyperlink was attached to every
run, emitting one duplicate relationship per run; and several derived geometries
disagreed. All agree again and are pinned in
`src/__tests__/fixtures/corpus-regressions.ts`.

The lesson is in that file's header: a differential comparison against the
previous implementation finds what a feature checklist does not.

### DOCX

| Change                                                                                                                                                                                                                                                                                                                                       | Why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A section that inherits a block's running head no longer inherits its page break (`blocks/report-chrome-consulting`, `blocks/report-chrome-fallback` moved).                                                                                                                                                                                 | A header can only change at a page boundary, and the tracker in the house running head varied per section, so every section under it started a new page and a short section left most of its page blank. The `running-head` block now heads every page with the document title alone, and only the declaring section (after the cover) breaks the page; the following sections continue on it as `continuous` section breaks with identical, inherited chrome. An authored `pageBreak: true` still breaks.                                                                                                                                                                                                                                                                                                                                                                                                                       |
| A header or footer whose components are all `enabled: false` breaks link-to-previous.                                                                                                                                                                                                                                                        | It used to compile to no part at all, which is how Word spells "inherit", so a section that explicitly disabled its chrome showed the previous section's — stale or confidential content included. Disabling everything is a statement about this section, exactly like an explicit empty array.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| A `themeStyle` naming a style the resolved theme does not define no longer emits `w:pStyle` (`text/theme-style-custom` moved).                                                                                                                                                                                                               | The corpus case deliberately names `noSuchStyle`, and the paragraph carried a reference to a style that is not in `styles.xml`. Word ignores it; LibreOffice drops the paragraph's _direct_ spacing with it, so a block that names a type role — the way `source-line` says "this line is the source line" — lost its section gap on a theme that declares no roles. The paragraph's own run and spacing props are the documented fallback, and the built-in ids (`Normal`, `Title`, `Subtitle`, the `JTD_HeadingText*` clones) are always emitted, so they are never withheld.                                                                                                                                                                                                                                                                                                                                                  |
| The report and deck blocks paint theme chrome recipes and the motif; every `blocks/*` golden moved.                                                                                                                                                                                                                                          | #361. A block paragraph that paints a type role now names it (`themeStyle`) instead of pinning `fonts.body.family`, so the role's face, case, tracking and weight reach the page — the house running head is upper-case tracked because its `tracker` role says so, and a cover title is set in the heading face. Chrome recipes reached their consumers: `tracker`, `runningHead`, `confidentialFooter`, `sourceLine`, `keyTakeaways`, `actionTitle`, `cover` and `logoSlot` each override the role they are drawn in through a `$theme` pointer chain, and the theme `motif` marks the top edge of the cover. A theme that declares none of this is unchanged: every binding falls through to the role, then to the literal the composition declares.                                                                                                                                                                          |
| An SVG in a first-page or even-page part ships a real raster fallback.                                                                                                                                                                                                                                                                       | The adapter's image walk read only the `default` chrome slot, so such an SVG got its own bytes labelled `image/png` as the fallback, and the section options dropped the part outright.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| A shape-mode `text-box` keeps its padding and its border colour on `office-open`.                                                                                                                                                                                                                                                            | The adapter spelled the insets `topInset`/`bottomInset`/`leftInset`/`rightInset` and nested the outline colour under `outline.fill`. `a:bodyPr` takes `lIns`/`tIns`/`rIns`/`bIns` (or a `margins` object), and `OutlineOptions` carries its colour at the top level — no `*Inset` key exists anywhere in the package, and a nested `fill` is ignored. Both values were accepted and then dropped, so every shape text box drew with default insets and a default-coloured border. `docxjs` always had them right; the two backends now agree.                                                                                                                                                                                                                                                                                                                                                                                    |
| Every `w:sz`, `w:b` and `w:i` that `office-open` writes carries its complex-script twin, `w:szCs`, `w:bCs` or `w:iCs`, as `docxjs` does (no corpus golden moved).                                                                                                                                                                            | Arabic, Hebrew and Thai are set from the twins, not from the Latin properties. docx.js adds one for every stated bold or italic, `off` included, and every non-zero size; `@office-open/docx` writes only what it is given, so every complex-script glyph on this backend fell to the document default — in LibreOffice, 12pt regular upright under a 21pt bold heading, in a 16pt bold run and in a 14pt italic one. The adapter now states the twins by the same rules, in runs, numbering levels, styles and document defaults, and `cross-backend.test.ts` checks each against its Latin property on every shared corpus case. docx.js's fourth twin, `w:highlightCs`, is not mirrored: OOXML defines no such element and the compiler sets no highlight. The goldens record `docxjs`, whose bytes did not change.                                                                                                           |
| A document whose last section ends on a text frame ends its body with a one-point exact paragraph after that frame, in both backends (no corpus case moved: none ends on a frame).                                                                                                                                                           | With the body ending on consecutive framed paragraphs in a section that has its own header or footer, LibreOffice drops the frame of the one before last and sets its text at the top of the page: the `modern-annual-report-3` back cover's "Follow Us" label. docx.js hid it while a section closed its bookmark in a bare trailing paragraph and showed it once the bookmark end moved into the last paragraph (22cbcff6, see _Section bookmark anchors_); `office-open`, which closes bookmarks between blocks, was exposed throughout. The paragraph is the same one-point exact anchor a section ending on a table gets, so a full last page does not spill an empty one. An earlier section needs none: its section properties close it in a paragraph of their own. Pinned structurally and through LibreOffice in `trailing-frame.test.ts`.                                                                             |
| A report that names no theme, or a theme that does not exist, renders on `consulting` instead of `minimal` (every `links/*` and `structure/*` case, `theme/name-omitted` and `theme/name-unknown-falls-back` moved).                                                                                                                         | #331. `consulting` is the house report style the design programme builds on; a document that named no theme got `minimal`'s sage ink, Calibri type and wide margins, a look nobody picked. `minimal` stays an explicit alternate and renders exactly as before — `theme/builtin-minimal` did not move.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| A style's `italic` reaches `styles.xml` on `docxjs`, with its `w:iCs` twin (every corpus golden moved, all 283 cases, `word/styles.xml` only).                                                                                                                                                                                               | The adapter passed style run options under `italic`; docx.js reads `italics` there, as it does on runs, and ignores a key it does not know, so every style's italic, `true` or `false`, was dropped on the default backend while `office-open` wrote it. A Heading 5 on `minimal`, `consulting` or `vermilion` drew upright on one backend and italic on the other. Checked part by part against the previous output: with the `<w:i/><w:iCs/>` pairs (either value) removed, every part of every case is identical, the pairs added are exactly the italics the IR declares on its styles, and `office-open` output did not change. The option bag is typed now, so a misspelt key does not compile.                                                                                                                                                                                                                            |
| Every table cell `office-open` writes ends on a paragraph, as on `docxjs`: a cell whose last block is a table gets an empty `<w:p/>` after it (no corpus golden moved).                                                                                                                                                                      | #468. Word's notes on ECMA-376 (MS-OI29500, §17.4.65 `tc`) ask for a `w:p` as a cell's last block; docx.js appends `<w:p/>` to any cell that ends otherwise, `@office-open/docx` only to one ending on neither a paragraph nor a table. The client report's cover band, a floating `text-box` ending on a table, became a cell ending on `</w:tbl>`: Word tolerated it, LibreOffice set the band in the flow under the subtitle, with no top rule and its first label 5.4pt right of its value. Pinned for both backends over the corpus and both report templates in `cross-backend.test.ts`, and through LibreOffice in `report-chrome.test.ts`. The next row gives the check against the previous output. `@office-open/docx` 0.14.6 closes a cell ending on a table itself, so the adapter now adds the paragraph only after a table of contents, which the backend still leaves open.                                       |
| On `office-open`, a bookmarked section that ends on a table, a contents field or nothing ends in a one-point exact paragraph before its bookmark end, as on `docxjs` (no corpus golden moved).                                                                                                                                               | #468. Floating again, a cover band whose client name wraps reached past the bottom margin, and on `office-open` the table was followed only by the paragraph holding the section's properties, where LibreOffice anchors a floating table: the cover gained a second page with nothing on it (six report cases of the rendered block matrix). docx.js closes the section's bookmark in a one-point paragraph there, which avoids it. Checked part by part, both rows together: `docxjs` did not change; on `office-open` 17 corpus cases and both report templates changed in `word/document.xml` only, 8 cells gaining the closing `<w:p/>` and 22 sections this paragraph, and are identical without them. Pinned in `emit.test.ts` and `report-chrome.test.ts`.                                                                                                                                                               |
| On `office-open`, a table of contents in a table cell — a table-rendered `text-box`, `columns` inside one — is written where it was dropped, as `docxjs` writes it (no corpus golden moved).                                                                                                                                                 | `@office-open/docx` writes a cell's paragraphs and tables and nothing else (`stringifyCellChild` answers any other child with an empty string), so the field vanished on this backend alone, its title left above nothing. The adapter now hands the cached entries over as paragraphs between two marker paragraphs and, once the package exists, replaces the three with the backend's own `stringifyTableOfContents` around them: the `w:sdt` it writes for the same table of contents in the body, byte for byte (`renderers/office-open/cellTocs.ts`). A cell that ends on one closes with `<w:p/>`, as on `docxjs`. Every corpus case rendered to the same digest on both backends before and after; LibreOffice draws the entries inside the box, laid out as on `docxjs`. Retired with `@office-open/docx` 0.14.6, which writes the field in a cell itself, byte for byte as the splice did (see the 0.14.6 rows below). |
| On `office-open`, tracking, indents, cell widths and margins, row heights, a floating table's offsets and the page's size, margins and columns are floored to whole twips, as on `docxjs` (no corpus golden moved).                                                                                                                          | OOXML states them in whole twips (`ST_TwipsMeasure`, `ST_SignedTwipsMeasure`, a `dxa` width); the IR holds what its arithmetic gave, and a theme's tracking is a share of an em times the size: `consulting`'s 8pt eyebrow tracks 12.8 twentieths of a point, its `tracker` 9.6. docx.js floors each such attribute (`decimalNumber` is `Math.floor`: −9.456 becomes −10, and under one twentieth still writes `w:val="0"`); `@office-open/docx` wrote `<w:spacing w:val="12.8"/>`, which the schema refuses, and LibreOffice set the client report's eyebrow and running head wider — the one pixel difference between the backends on that template, now gone. Paragraph spacing, tab stops and frames stay as given, as docx.js writes them. The last paragraph of this section gives the check.                                                                                                                              |
| A line height set as a multiple is written in whole twips on both backends, as is a tab stop, a frame or a statistic's spacing stated with a fraction (the four `devportal` cases moved, `word/styles.xml` only).                                                                                                                            | OOXML types `w:line` as `ST_SignedTwipsMeasure` and `w:before`/`w:after` as `ST_TwipsMeasure`, integers both, and the compiler turned a multiple into 240ths unrounded: `devportal`'s 1.02-line Title wrote `w:line="244.8"`, and three annual-report templates 299 values such as 277.68 for 1.157 lines and `266.40000000000003` for 1.11. docx.js writes these as given, as it does `w:tab`'s `w:pos` and `w:framePr`, and `@office-open/docx` passes a number through, so both wrote the same invalid value. The compiler now rounds each to the nearest twip (`wholeTwips` in `ir/units.ts`). Only line heights were fractional in the corpus and the gallery, so nothing else moved, and LibreOffice draws the moved documents as before. The last paragraph of this section gives the check.                                                                                                                              |
| docx 9.7.1 → 9.8.0 (#478): every corpus golden moved (all 282 cases), in sixteen classes of package change; `office-open` did not move.                                                                                                                                                                                                      | The release fixes a run of schema-order and vocabulary defects and adds a theme part. The classes, the parts each touches and the proof that nothing else moved follow the table.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| A shape-mode `text-box` with both a fill and a border draws both, on both backends (`blocks/text-box-shape-fill-and-padding` moved).                                                                                                                                                                                                         | docx 9.7.1 wrote the outline ahead of the fill, an order Word rejects, so the compiler dropped the border with a warning; 9.8.0 writes CT_ShapeProperties order (dolanmiu/docx#3521).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| A link after an image in the same part keeps its relationship: package finalization renames relationship ids by attribute rather than by pairs of quotes (no corpus golden moved).                                                                                                                                                           | docx.js writes empty attributes on every drawing (`name=""` on `wp:docPr`, among others). Renaming volatile ids by pairs of quotes lost step on an empty value, so after an odd number of them the hyperlink's relationship was renamed and its `r:id` was not — a dangling reference Word reports as a damaged file. No corpus case put an image before a link, which is why the corpus-wide dangling-reference test stayed green; `relationship-ids.test.ts` now builds one. A part changes only where an id followed an empty attribute, which is exactly where the reference used to dangle, so no golden moved. Native charts (`name=""` on every chart drawing) and drawing groups would have made it certain.                                                                                                                                                                                                             |
| Embedded Office packages are normalized recursively; an office-open chart workbook's own ZIP headers now follow a caller's `generatedAt` (no golden moved; unchanged at the default date).                                                                                                                                                   | docx.js stamps a native chart's workbook ZIP entries from the wall clock, so two renders a second apart differed in `word/embeddings/*.xlsx` alone. Package finalization now walks every embedded xlsx, xlsm, docx and pptx, three levels deep as the pptx packager does, pins its `docProps/core.xml` dates and ZIP headers to `generatedAt`, and rewrites a package only when something in it differs, keeping every inner compressed stream. office-open's workbooks are built pinned to the default date, so at that date they come out byte for byte as before; with a caller's `generatedAt` their headers now carry it instead of 2000-01-01, and nothing else in the package changes. No corpus case embeds a package.                                                                                                                                                                                                   |
| A native `chart` draws on `docxjs`, through docx 9.8's `ChartRun` (13 new cases: `chart/*` and `blocks/chart-figure-native`; no existing golden moved).                                                                                                                                                                                      | docx.js had no chart primitive until 9.8.0 added `docx/charts`, so the capability gate refused a chart on the default renderer. The adapter now maps the IR's chart run onto `ChartRun`, which writes the chart part, its relationship and its own workbook; the text roles are shared with office-open, so both state the same face, size, weight and colour on every text element. The entry is imported when `render()` starts, not with the package, so an older docx fails only a document that draws a chart. Both renderers now refuse a multi-series pie, a negative pie or doughnut value, an empty series, a non-finite value and a chart with no room, naming the path. How both renderers style the plot is under Native charts on docx.js.                                                                                                                                                                          |
| `office-open` charts take Word's Insert Chart look, as `docxjs` draws it: gridlines, axis lines, ticks, gaps, markers, slice borders, a doughnut's hole; no golden moved.                                                                                                                                                                    | `@office-open/docx` states none of a chart's plot styling, so each reader drew its own and the two renderers' charts differed; two gaps misdrew the data — scatter x values went in as text, plotted at 1, 2, 3…, and an untitled chart got a title from its series' name, which rescaled its value axis. `office-open/chartLook.ts` states the `docxjs` look (#478). `docxjs` moved in no package and pptx in none; on `office-open` the 13 chart cases and `native-chart` moved, in `word/charts/chart*.xml` and the scatter workbook only. In Word and LibreOffice 12 of the 14 render pixel-identical to `docxjs`; `chart/in-text-box` sits a point higher, from a bookmark paragraph, and `chart/in-header-and-footer` keeps the chrome gap under Native charts.                                                                                                                                                            |
| The default renderer draws a native `visual` (#478): four `drawings/*` corpus cases were added, recorded on docx.js, and no existing golden moved.                                                                                                                                                                                           | docx 9.8.0's `docx/shapes` gives docx.js a drawing group, so `drawing-groups` joined its capability set and `renderMode: "native"` no longer needs `"renderer": "office-open"`. `docx/shapes` is imported, and the post-pack repair (`drawingGroupRepair.ts`) runs, only when the IR holds a group, so no other package can change: a dump of every corpus case, gallery template and example moved 0 of 296 docx.js and 0 of 291 office-open packages, and `examples/native-visual.docx.json` now renders on docx.js too. The new cases keep every child inside its canvas, so the cross-backend comparison holds their text, counts and extents to office-open's.                                                                                                                                                                                                                                                              |
| Every document's `word/theme/theme1.xml` carries its jto theme instead of Office's: the theme's name, ten scheme colours and heading/body fonts (every corpus golden moved, all 299 cases, `theme1.xml` only).                                                                                                                               | Word's colour menus (Theme Colors) and font menu offered Office's palette in a jto document: blue, orange and Calibri from `office-open`'s Office theme, and on `docxjs`, which wrote no theme part before 9.8.0, Word's own default (Aptos in current Word). The slots are the twin deck's (#258): dk1, lt1, dk2 and lt2 hold `text`, `background`, `textSecondary` and `backgroundSecondary`; accent1–6 hold `primary`, `secondary`, `accent` and `accent4`–`accent6`; the major and minor fonts are the heading and body families. hlink and folHlink keep Office's: jto has no link colour. Only a native chart draws from it, on both backends, as Word's own charts do, so no page moves but a chart's gridlines and axis lines, now a tint of the jto Text 1; the proof, and `office-open`'s unused styles naming it, follow below the table.                                                                             |
| `@office-open/docx` 0.11.0 → 0.14.6: every `office-open` package moved (all 308), in seventeen classes of package change; `docxjs` and the goldens did not (one case added, `headings/toc-in-text-box`). A chart in a header or footer opens in Word and draws in LibreOffice (#485), and an image drawn at several sizes is one media part. | 0.14 renamed most of the option vocabulary, and the adapter hands the backend its options as data: on the raw bump 92 of the 308 documents failed to render and 216 lost lists, margins or chart colours with no error. The adapter is migrated and typed against the backend's option types, a chart's look is stated as options, and the workarounds 0.14 made redundant are gone: the chart splice (but for a scatter chart's style), the cell-TOC splice and the per-size image markers. Three 0.14 regressions are held off in the adapter, so they move nothing. The classes, the parts each touches and the proof follow the table.                                                                                                                                                                                                                                                                                       |

| A `statistic` renders its `unit`, `size`, `trend` and `trendValue`, under two styles the document now defines. | All four props were declared, accepted by the schema and read by nothing: `{ "number": "99", "unit": "%" }` rendered `99`, and the shipped `docx-report` starter lost its percent sign with no diagnostic anywhere in the pipeline. The two paragraphs also named `StatisticNumber` and `StatisticDescription`, which no theme and no generator ever defined — an undefined `w:pStyle` resolves to Normal in silence, so the component purpose-built for KPIs set at body size and weight. The styles are appended only to documents that contain a statistic, so nothing else moved. `format` stays unimplemented and now warns (`W_STATISTIC_FORMAT_IGNORED`) rather than vanishing. |
| A body paragraph or list item directly under a table gets 120 twips above it. | OOXML gives a table no space-after — the property does not exist — so the block below one drew hard against its bottom rule. A heading was already spaced by its own style and is left alone; only styles that contribute nothing of their own are topped up. |
| A list marker sits inside the text margin. | Every bundled theme set `componentDefaults.list.indent: 3`. That field is points, so level 0 compiled to `w:ind w:left="60" w:hanging="360"` — a marker 300 twips to the _left_ of the page margin, outdented past the body text it labels. The themes no longer state it, so the per-level default (720/360, Word's own) applies. `IndentSchema` now documents its unit; the neighbouring `ParagraphIndentSchema` is twips, and neither said so. |
| The section number of a numbered heading carries the section gap, and the heading under it carries none (`blocks/report-chrome-consulting`, `blocks/report-chrome-fallback` moved again). | The gap sat on the heading, with the number above it in the space that separates two sections, so the number read as a footnote to the section that had ended rather than the number of the one starting — a regression of the flowing sections above (#410). The `section-opener` definitions in both report templates now state `spacing` on both paragraphs: the theme's `heading1` space-before above the number, none between the number and its heading, and the heading keeps its style's gap when no number is given. Definitions only; the compiler and both adapters are unchanged, which is why only the two cases that invoke the block moved. |
| The `theme/example-proposal` and `theme/example-technical-guide` goldens moved because the documents changed, not the pipeline. | The shipped `proposal` and `technical-guide` templates were rebuilt at stock-template fidelity: a full-bleed SVG cover section with page-anchored floating text, an inline-SVG brand band and a real architecture diagram. The rebuild also removed the templates’ `placehold.co` image URLs — the only remote fetches in any shipped document — so rendering them no longer needs the network. They moved again when both documents were restyled onto the bundled `vermilion` theme, the design system shared by the `vermilion-annual-report` stock template and the runnable examples. |
| A table border side named on a cell or column now always renders, and no contested interior edge leaves the compiler (`tables/borders-per-side` and `tables/borders-zero-size` moved; `tables/borders-edge-ownership` pins the rules). | Adjacent cells each carry half of a shared edge, and the halves could disagree — a cell's named red `right` against the neighbour's inherited grey `left`. Word resolves that conflict by ECMA-376 §17.4.66's weight rules (wider, then darker by `R+B+2G` → `B+2G` → `G`) and drew the red; LibreOffice resolves it its own way and drew the grey — so the playground's LibreOffice-rendered PDF preview contradicted the downloaded file, and the `vermilion-annual-report` tables had to state both halves of every internal edge to be safe. The table model now adjudicates every interior edge — a named side beats an inherited one, equals fall to the same §17.4.66 rules — and mirrors the winner onto both cells, so every consumer draws the same edge. `hideBorders` also stopped silencing named sides: hiding is a table-level statement, and the cell and column layers already outrank the table everywhere else. Scalar `borderColor`/`borderSize` stay restyling knobs that claim no side. |
| An object-form table-level `borderColor`/`borderSize` now survives a theme whose `componentDefaults.table` states a scalar for the same key (part of the `tables/borders-per-side` move). | `mergeWithDefaults` recursed into the theme default even when it was a scalar, so `deepMerge('#f0f0f0', { top: 'FF0000' })` spread the string into `{0:'#',1:'f',…}` and the author's per-side object was silently destroyed — the old golden pinned black fallback borders where the document stated red and blue ones. The merge now lets a user object replace a non-object default outright. |
| A `statistic` on a theme with type roles paints in them: the figure in the `stat` role, the unit, trend and caption at the `label` size (`blocks/key-takeaways-consulting`, `blocks/report-chrome-consulting`, `blocks/report-data-consulting`, `blocks/figures-consulting`, `theme/builtin-consulting`, `theme/builtin-vermilion`, `theme/builtin-devportal` and `theme/overrides-over-named-theme` moved). | #454. The component pinned a 28pt bold figure (20pt `small`, 40pt `large`), a unit at half the figure and a 10pt caption — five sizes a theme never paints — so a client report built from the house `kpi-row` needed a size ceiling of eleven. `statisticSizes` now decides for the style set, the compiler and the quality facts alike: a theme restyling `StatisticNumber`/`StatisticDescription` still wins; else the figure takes the `stat` role's size, face, weight and colour, `small`/`large` a step of the theme's type scale either side, and unit, trend and caption the `label` role's size. The consulting `stat` role is now 22pt regular in the accent (Paolo's choice from rendered options, figures lighter than the 28pt bold they replace), so every consulting case moved with the style set; the vermilion and devportal samplers carry a statistic, now at their own roles (20pt and 16pt, bold, accent). A theme without roles, `minimal` among them, renders exactly as before. |
| A header or footer paragraph keeps its `characterSpacing`, and can name a `themeStyle`, `tabStops` and `indent` (`theme/example-practice-note` moved). | Page chrome was compiled by a narrower path that read text, alignment, font and spacing and dropped everything else on the floor: the `practice-note` template's running head authored 20-twentieths tracking on its eyebrow and rendered without it. The running-head block needs the rest — a type role named as a style so Word's style pane agrees with the theme, a right tab for the tracker and a centre tab for `n / N` — so the chrome path now carries them. Run properties stay explicit on every run, resolved from the named style, because LibreOffice paints a page-number field with the document default when the run around it says nothing. Nothing else in the corpus authored any of these in chrome, so only the one golden moved, by exactly the tracking it asked for. |
| An inline SVG containing `<text>` keeps the vector-only fallback (`theme/example-proposal` and `theme/example-technical-guide` moved). | Text rasterizes with whatever fonts the generating machine offers, so the same document produced different fallback PNG bytes on macOS, Linux and Windows — the first text-bearing template SVGs made these two goldens platform-dependent, recorded on one OS and failing on the others. The raster fallback is skipped for text-bearing SVGs with an `IMAGE_SVG_RASTER_SKIPPED` warning, the same route the pixel-budget sliver check already takes; Word 2016+ and LibreOffice draw the vector regardless, and a portable fallback wants the text as paths. |
| A backslash escapes the inline mini-language, so `\_`, `\*`, `\[`, `\]`, `\{`, `\}` and `\\` render as themselves (`text/decorators-edge-cases` moved). | A code sample was unwritable. `grant_type=client_credentials` has two underscores, so the parser read the span between them as emphasis and the reader got _granttype=clientcredentials_ — visible in the shipped `technical-guide` for as long as it had code in it. Escapes are swapped for private-use sentinels before any pass runs and swapped back where authored text becomes runs, so no later pass can mistake one for markup. A backslash before anything else stays a backslash, which is why only the one corpus case that deliberately wrote `\*` moved. `parseLiteral` does not unescape: the paths that promise character-for-character output still give one. |
| The `theme/example-proposal` and `theme/example-technical-guide` goldens moved again, with both documents rebuilt from scratch. | The two shipped templates were re-authored against the `vermilion-annual-report` stock template as the reference: its display-heading scale, its hairline tables with a single accent rule and flush-left first column, its muted body colour and tinted emphasis rows. The structural change worth knowing is that each numbered part is no longer its own Word `section`. A section exists to change page setup or chrome, these parts change neither, and a section ends with the empty paragraph that carries its break — which produced a blank page whenever a part happened to fill its last page. Both documents now use three sections (cover, body, back cover) and put `pageBreak` on each part's opening paragraph instead. |
| `theme/example-technical-guide` moved once more: the guide changed theme. | The two shipped documents were reading as one house style, which is not what a pair of examples is for. The proposal keeps `vermilion`; the integration guide moved to the bundled `devportal` theme — cool slate, one teal accent, monospace where the reader is expected to type — which until now no shipped document used. The composition rules carried over unchanged (hairline tables, flush-left first column, short tables held whole, no page under 70% full); the dressing did not: the section index is monospaced, headings are set solid over the theme's own accent rule instead of large and light, table headers are a shaded band rather than an accent vertical rule, and code sits in a closed fence. Page geometry moved with the theme — `devportal` margins give a 487.3pt measure against `vermilion`'s 477.3pt — so every fixed column width and every page break was re-checked. |
| A `{PAGE}` or `{TOTAL_PAGES}` field is written as one run per field character, each carrying the run's own `rPr` (every corpus case containing a page field moved — 11 of them, including both shipped templates). | docx.js packs `begin`, `instrText`, `separate` and `end` into a single `w:r`. Word reads that; LibreOffice does not — it computes the number itself and paints it with the document default, so the `Page {PAGE}` running header both shipped templates use rendered "Page" at 8pt grey and the numeral at 11pt black, in the PDF path and therefore in `jto_preview`. Splitting the field characters across runs that each repeat the `rPr` is what LibreOffice honours, and it is the shape Word itself writes. Measured, not reasoned: six XML shapes were rendered through `soffice --convert-to pdf` and the glyphs' font, size and colour read back out of the PDF. Splitting fixes it with or without a cached result; a cached result inside the single run does **not** (nor does a `w:fldSimple` carrying a fully formatted cached run — LibreOffice recomputes and discards that run's properties), which is why the fix is the run split and not a cached value. `<w:pgNum/>`, which would inherit `rPr` for free, renders as nothing at all. |
| No cached result is written between `separate` and `end`. | Nothing in this pipeline paginates, so the only value available is a fabricated one — right on page 1 and wrong on every page after it, in any reader that shows the cached result instead of recomputing. An empty result is what docx.js already emitted and what both Word and LibreOffice recompute on their own, so declining to invent one costs nothing. This is the opposite call from the TOC field, which _does_ ship cached entries (`toc-cached-entries.test.ts`): there the cached text is the real heading text, known at generation time, and without it a non-refreshing reader shows an empty TOC. A page number is not known at generation time. |
| The five bundled themes (`apex`, `corporate`, `minimal`, `devportal`, `modern`) were redesigned; every corpus golden except `theme/example-proposal` moved, because `minimal` is the corpus default and a theme's full style set is embedded in every package. | Verified against LibreOffice renders of a sampler exercising every style a theme controls. What changed, uniformly: every theme now defines `heading1..6` — an undefined level fell back to the raw `fonts.heading` size, so an h4 rendered _larger than h2_, at 24–28pt, in four of five themes; `componentDefaults.table` grew a real header treatment (bold, per-theme fill or rule, hidden vertical rules, cell padding) where tables were bare hairline grids with unstyled headers; `normal` is left-aligned everywhere — three themes justified without hyphenation, which rivers; `textMuted` passes readable contrast, since `StatisticDescription` sets real text in it (three themes were at 2.4–3.0:1); each theme states `TOC1..3` (tab position matches its own text measure); headings pin a tight `lineSpacing` so a wrapped heading no longer inherits body leading; and each palette fills `accent4-6`, so charts draw from six curated series colours instead of three. Per theme: `apex` keeps Georgia/navy but uses gold only in rules (gold _text_ at 13pt was 2.2:1); `corporate` moves display to Cambria and keeps its blues; `minimal` is fully achromatic (grayscale chart ramp included), Helvetica, 3cm margins, and drops two `characterSpacing` values of 1.2 and 0.8 — twentieths of a point, i.e. invisible no-ops; `devportal` keeps its slate/teal palette (the shipped guide hardcodes it) but darkens h3 text to the guide's own `#0F766E` and sets h5 in mono; `modern` drops the violet/cyan clash for a single violet family. `vermilion` had the same undefined-h4–h6 hole and gained the three levels in its own voice (which is the only reason `theme/example-proposal` moved — its palette, metrics and componentDefaults are untouched). `structure/columns-explicit-widths` shrank its fixed widths (456pt of columns no longer fit `minimal`'s new 425pt measure — the validator correctly refuses); `devportal` margins stayed at 1080 twips because the technical guide's fixed widths were audited against that exact 487.3pt measure. |
| A list stating both `format: 'bullet'` and a `bullet` character renders that character (`lists/bullet-custom-character` moved). | `createLevelsFromSimplifiedProps` read `bullet` only on the no-`format` path, so an explicit `format: 'bullet'` silently discarded the marker — and since `mergeWithDefaults` folds each theme's `componentDefaults.list.format` into every list, a document-level `bullet` was _always_ on the explicit-format path: the corpus case named for replacing the glyph was recorded rendering the default `•`. Every bundled theme also shipped a `bullet` no renderer read — the same dead-config class `bundled-themes.test.ts` exists to catch, but a level below the schema. |
| A body block directly above a table gets its space-after topped up to `max(theme body space-after, 240 twips)`, and the last item of a list stops inheriting the inter-item gap (57 goldens moved: every case with a body block touching a table, plus every list whose theme states `item` spacing). | The mirror image of the 120-twips rule below a table: a table has no space-before either, so the gap above one was whatever the body style left — 160–180 twips in the bundled themes, reading as text sitting on the table's top rule. Same guards as the below rule: body styles only (a heading right before a table is a caption and keeps its own style's space-after), and a stated instance `spacing.after` is the author's answer, even below the floor. `Math.max` against the theme's own body space-after so a theme roomier than the floor is never tightened. The list half is what made the rule reachable: `itemSpacing` gave the _last_ item the inter-item gap (`item: 2` → a list ended 40 twips before whatever followed), so the themes' `item` spacing was silently answering the question for every list. The item gap is between items; the last item now falls back to the body style's space-after, and the themes dropped their redundant `list.spacing.after` (it restated that same value). |
| `vermilion` gained `componentDefaults` — the `vermilion-annual-report` table recipe as the theme default (`theme/builtin-vermilion`, `structure/page-override-per-section` and `theme/example-proposal` moved). | Its sampler table was a bare LibreOffice grid: the theme declared no table treatment, while both documents authored in it restate the same recipe on every table — gray `#C7C8CA` hairlines, hidden top/left/right/inside-vertical, full width, red `#EF4130` bold headers over a red hairline, 9.5pt cells with 7pt vertical padding. That recipe, taken verbatim from the shipped `proposal` (the annual-report pattern adapted to Calibri), is now the theme's `componentDefaults.table`; `list` (em-dash marker), `image`/`statistic` (center) and `section.pageBreak: false` come along, so all three bundled themes carry the same default surface. `keepInOnePage` deliberately stays per-document — as a default it would forbid every long table from splitting. The `proposal` then shed the 95 table props that restated the new defaults, proven a no-op by digest equality before and after; `table-border-merge.test.ts` moved onto a `createMinimalTheme` scaffold via `customThemes`, since no bundled theme is free of table defaults any more. |
| `minimal` and `devportal` absorbed the shipped examples' `themeOverrides`, which are gone: `minimal` is now the practice-note look (Calibri, sage-green ink on ivory) and `devportal` the field-review look (Helvetica, near-black ink with a burnt-orange accent, displayName "Field Editorial"); 270 of 273 goldens moved — every case except the three pinned to the untouched `vermilion`. | The two examples were the only documents exercising the override surface, and each override block was a complete second identity stacked on a theme that no shipped document used as-is any more. Folding them in makes the examples pure theme citizens (`props.theme` and nothing else) and the themes the single source of the looks. The folds are exact merges of base theme + override, so both documents render pixel-identically before and after — verified page by page — except one deliberate repair below. Chart-slot duplicates were de-duplicated where no document pinned them (`minimal.accent`, `devportal.accent4`), page geometry stays per-document (`themeOverrides` never carried it), and the value-pinned tests (chart palette, divider, cell colors, note styles, the `Helvetica` theme sentinel, the corpus colour-control case) moved with the palettes. |
| A table where no column declares a `header` emits no header row (`theme/example-field-review` and every headerless corpus case moved). | The model emitted a header row unconditionally — for a cells-only table, an empty row wearing `headerCellDefaults` and the column fills. It was invisible while nothing styled it distinctly (the field-review scorecard's phantom row painted itself in the columns' own dark and orange fills and read as a taller first row), and became a bare tinted band the moment a theme header fill arrived. Headerless tables now start at their first body row, which takes the top outer border and `hideBorders.top` gating; header-only chrome tables (both examples' running footers) are the unaffected inverse. The scorecard now renders four clean rows, closer to its reference document than before. |
| The two shipped example documents were replaced: `proposal` and `technical-guide` gave way to `practice-note` (Atelier Still, single column on `minimal`) and `field-review` (Northstar, two columns on `vermilion`) — `theme/example-proposal` and `theme/example-technical-guide` left the corpus, `theme/example-practice-note` and `theme/example-field-review` joined it. | Both are reproductions of reference Word documents, rebuilt as JSON with the design carried by the theme plus `themeOverrides` — the first shipped documents to demonstrate the override surface (a warm sage-and-ivory palette over `minimal`; a burnt-orange palette over `vermilion`). The reference files named Lato and Inter, which have no metric-compatible face in the hosted preview image and would put font fetching inside the corpus, so the reproductions set Calibri and Helvetica — the metric-covered families the themes guide recommends. Their page frames are header-anchored inline-SVG rects (the stock-template page-decoration pattern; the pipeline has no `w:pgBorders`), two-part running footers are borderless header-cell tables (the `technical-guide` pattern), and the two-column pages are `columns` components with explicit `columnBreak` paragraphs. Both carry only inline SVG, so the corpus `inlineImages` pass is now a guard rather than an edit. |
| The `corporate`, `apex` and `modern` themes were removed; the bundle is `minimal`, `devportal`, `vermilion`. The three surviving themes set their `mono` role to Courier New. `theme/builtin-vermilion` is new; `theme/builtin-{corporate,modern,apex}` are gone; `structure/theme-page-source`, `structure/page-override-per-section` and `theme/overrides-over-named-theme` moved to surviving themes; `theme/builtin-devportal` and `theme/example-technical-guide` moved for the mono swap. | Three themes carry the bundle's range on their own (neutral default, technical, editorial), and every family the survivors name — Helvetica, Arial, Calibri, Courier New — has a metric-compatible substitute in the hosted preview image (Liberation Sans, Carlito, Liberation Mono per the Dockerfile's font packages), so the LibreOffice PDF breaks lines where Word does. Menlo and Consolas do not: local.conf falls both back to DejaVu Sans Mono, and Consolas' 0.55 em advance against DejaVu's 0.60 makes previewed code run visibly long — which is why the mono role moved to Courier New everywhere, the one metric-faithful safe mono. `minimal`'s mono swap moved nothing: no `minimal` style references the role. The exported `corporateTheme`/`modernTheme` consts are gone; `devportalTheme`/`vermilionTheme` are exported instead. Separately, the shipped documents stopped restating what their theme already provides (76 removals: table `borderSize`/`hideBorders`, list `bullet`, image `alignment` equal to `componentDefaults`, a `background: #FFFFFF` override equal to the palette, first-section `pageBreak: false` equal to the theme default) — proven a no-op by digest equality before and after on `technical-guide` and `vermilion-annual-report`, which is why no golden moved for it. |
| Cached TOC entry paragraphs carry no `w:tabs` of their own, so the entry takes the tab stop of its `TOC1`..`TOC6` style (every case with a cached TOC moved: `headings/decorators-in-text`, `headings/toc-*` (10) and `theme/toc-entry-styles`). | docx.js pinned a `clear` stop at 9026 and a dot-leader right stop at 9025 on every cached entry, whatever the page or theme, and `office-open` copied the dot-leader stop. Paragraph tabs beat style tabs, so every reader that shows the cached entries without refreshing the field (LibreOffice, the PDF path) drew dot leaders a theme like `consulting` (`leader: none`) never asked for; only Word, refreshing the dirty field, showed the theme. The page number stays empty: nothing before a layout pass knows it. |
| The corpus image fixtures are real PNGs now (33 cases moved: every case that embeds one — `structure/header-image`, `tables/nested-image`, `blocks/report-chrome-consulting`, `blocks/figures-*`, the fifteen `blocks/image-*` cases, `blocks/text-box-mixed-children`, and the twelve `theme/*` cases that draw the fixture). | The 4x2 PNG the fixtures shared had wrong IHDR and IDAT CRCs, pixel data that would not inflate and a cut-off IEND: its header sized fine, so every golden passed, while Word showed "The picture can't be displayed" and LibreOffice drew nothing. Each copy was replaced by a valid PNG of the same pixel size, so layout is unchanged and only the `word/media` bytes differ. Loading now refuses such bytes as `ASSET_UNREADABLE`, and `jto-ops`' `fixture-images.test.ts` keeps them out of the sources. |
| A `text-box` border side authored `solid` is written `w:val="single"` on `office-open`, and `docxjs` writes a theme border style as the theme states it (no corpus golden moved). | The compiler passed a text box's authored word into the IR, and `solid` is the CSS-shaped authoring vocabulary, not an ST_Border value. `docxjs` drew the word it did not know as `single`; `office-open` wrote `<w:top w:val="solid" …/>` into `w:tcBorders`, and LibreOffice drew no border at all — a 1pt blue box rendered with four blue rules on `docxjs` and none on `office-open`. The compiler now translates the vocabulary the way `divider` always had (`solid` → `single`; `dashed`, `dotted`, `double` and `none` unchanged), `DocxIrBorder.style` is typed as ST_Border's line styles, and IR validation rejects any other word on every border slot. With that guaranteed, `docxjs` stopped mapping: it sent every style outside five (six in `styles.xml`) to `single`, so a theme's `wave`, `triple` or `thickThinSmallGap` rule drew as a plain line there and as stated on `office-open`. A theme handed over as an object (`customThemes`) is not validated on the way in, so its border style is checked on the way into the IR, and a word outside the vocabulary draws `single` on both backends. |

No corpus golden moved for the text-box fix: the goldens record the _default_
backend's bytes, and `docxjs` was already correct. The two spellings are pinned
directly in `renderers/office-open/__tests__/emit.test.ts` instead, which is
where a difference between the backends' option vocabularies belongs.

None moved for the border vocabulary either, and that was measured rather than
assumed: every corpus case was generated on both backends by the code before
and after the change. `docxjs` reproduced all 283 recorded digests both times.
On `office-open` eight cases changed — `blocks/text-box-inline-styled`,
`blocks/text-box-mixed-children`, the four `blocks/report-chrome-*` and
`blocks/report-data-*` cases, `theme/example-field-review` and
`theme/example-practice-note`, each drawing a text box authored `solid`,
directly or through a block — in `word/document.xml` only, and rewriting the
old `w:val="solid"` to `single` (13 sides) makes every part byte-identical.
Both spellings are pinned in `__tests__/border-styles.test.ts`, on both
backends.

A field still loses its formatting on `office-open`, and that one is recorded
rather than fixed. That adapter writes every field — `PAGE`, `NUMPAGES` and
`REF` alike — as a bare `<w:fldSimple w:instr="…"/>` carrying no run properties
at all, so the same footer is wrong there in Word too, not only in LibreOffice.
The backend does expose the shape that would fix it (`complexField`, whose
`rPrXml`/`resultRPrXml` produce exactly the split runs `docxjs` now emits), but
those fields take a raw `w:rPr` **string**, and `renderers/office-open/emit.ts`
is a pure IR-to-option-bag function that deliberately never imports the
optional backend — so filling them means either breaking that seam or keeping a
second copy of the backend's run-property serializer in the adapter, where it
would drift out of step with `runProperties()` one property at a time. Neither
is worth it for an experimental opt-in backend to fix a defect the default one
no longer has. `REF` has the same gap on both backends, for the same reason:
`SimpleField` takes an instruction and a cached string and nothing else.

One table difference is recorded rather than chased: the compiler never states
table-level borders — every cell states all four adjudicated sides — and on a
`Table` without a `borders` option docx.js writes its own default
single/auto/sz-4 `w:tblBorders` block while `office-open` writes none. Both
spellings are unreadable behind the fully-stated `w:tcBorders`, which override
the table's borders on every edge, so aligning the bytes would move every
table golden for nothing. The emit test above pins that `office-open` keeps
writing no table borders.

The `annotations/notes-in-nested-components` golden also changed because the
fixture now includes a footnote inside a text box. That combination was omitted
while the old component render cache could replay the reference without its
document-scoped note body; stateless compilation makes it stable and testable.

Five goldens moved when a section's own page setup started to count (#423).
A continuous section break cannot change the paper size or orientation — Word
starts a new page regardless, LibreOffice keeps the old size — so a section
that would continue on the page but changes either now writes
`w:type="nextPage"` and warns `W_SECTION_PAGE_BREAK_FORCED`; margins-only
changes stay continuous. That moves `structure/page-size-named`,
`structure/page-size-custom` and `structure/page-override-per-section`, whose
sections continue by the theme's `componentDefaults.section.pageBreak: false`.
Content inside such a section is now measured against its own text width
rather than the theme's, so explicit columns fill the section's measure:
`structure/columns-between-body` (900-twip side margins, columns 4373 → 4913
twips) and `theme/example-field-review` (4663 → 4723 twips) moved for that.

Sixty-six goldens moved when every table grid started to say twips. A table
whose columns name no width was compiled with a grid of percentages, and both
backends wrote each share as a width: `w:gridCol w:w="25"` for a quarter of
the table. Word and LibreOffice lay such a table out from its `pct` width and
scale the grid, so no render showed it; Google Docs, Apple Pages and QuickLook
take the grid as the physical column widths and ignore a percentage, which
collapses every column to about a character (dolanmiu/docx#3476; not yet
checked in those readers here). The compiler now sizes the grid in whole twips
against the measure the table stands in (`ir/measure.ts`, handed down on each
component's scope): the section's text column — the page less its side
margins and gutter, one column of a multi-column section, the narrowest when
the columns differ — the whole text width in a header or footer, and for a
table in a cell the cell's width less its side margins, which is the width
LibreOffice draws a nested percentage table at. A text box's one-cell table
stated no grid at all and got each backend's 100-twip placeholder column; it
is sized to the box the same way. `w:tblW` stays `pct`. Only `w:gridCol`
values changed, checked part by part against the previous output of every
moved case: 50 grids went from percentages to twips, 31 text-box placeholders
to the box's width, and no grid already in twips moved. The cases are the 28
`tables/*` whose columns state no width, the nine table-rendered
`blocks/text-box-*` and the four `blocks/report-chrome-*` and
`blocks/report-data-*`, the 17 `theme/*` whose sampler draws a table, the six
`annotations/*`, `headings/toc-in-nested-container` and `links/in-table-cell`
that hold a table or a text box.

Two more moved when everything else sized as a share of the text area took the
same measure (`blocks/text-box-nested-columns`,
`blocks/text-box-nested-columns-floating`). A table's stated percentages and a
nested `columns`' cells and gaps were resolved against the page's text width
wherever they stood, so a table with two `50%` columns in a text box padded
72pt a side came out as wide as the page's measure and ran two inches past the
box — a `dxa` width is drawn as stated, in Word and LibreOffice alike — and
the table overflow warning measured the page rather than the box. Both now
take the box's content width, and a divider's percentage width takes its
column's, where half the page's measure indented it past the edge of a column.
In the two cases only the nested columns' `w:gridCol`, `w:tcW` and gap
`w:tcMar` changed (the floating box's columns from 4253 to 2250 twips each, a
5% gap from 212 to 112 twips a side), and LibreOffice sets the columns inside
the box. The gutter is part of the measure wherever the page is measured now:
`getPageSetup` dropped a theme's gutter, so it never reached the page, and every
text-width computation left a gutter in. No other golden moved: the one corpus
case with a gutter (`structure/page-margins-full`, set on its section) holds
nothing that is sized against the measure.

Nothing moved when images, native visuals, native charts and text-box shapes
took the same measure. A width they state as a percentage, an image's default
of the whole measure and a chart's default width are now of the box or column
they stand in rather than the page: an image with no width in a text box padded
72pt a side came out two inches wider than the box in every reader, since a
drawing's extent is absolute. The corpus's one image in a text box
(`blocks/text-box-mixed-children`) states its width in pixels, no corpus case
puts a native visual in one, and the default backend drew neither charts nor
drawing groups then, so no golden moved; now that it draws charts,
`chart/in-text-box` covers one. `__tests__/media-measure.test.ts` pins the
extents on both backends for images, shapes, native visuals and charts, and
LibreOffice sets all four inside the box. Heights stay page-relative, anchored
positions stay relative to the page or its margins as OOXML defines them,
`widthRelativeTo: 'page'` stays page-wide, and an image in a table cell keeps
its nominal 300 × 200 px box. A `highcharts` chart keeps a page-relative type
scale: it is rendered while externals are desugared, before layout knows what
holds it, so in a narrower box it is placed to fit with proportionally smaller
type.

280 goldens moved when a theme's header and footer distances started to reach
the page. The theme schema requires `page.margins.header` and `footer`, and
every bundled theme states them — `minimal` 850 twips, `consulting` 680,
`devportal` 720, `vermilion` 620 — but `getPageSetup` returned the four edges
and the gutter only, so the one distance that reached `w:pgMar` was a section's
own `page.margins.header` or `footer`. Everywhere else each backend wrote its
own default: docx.js 708 for both, office-open 851 and 992. A document's
running head and foot sat somewhere different on each backend and on neither
where the theme put them, and a running head taller than the gap its distance
left under the top margin pushed the body down by a backend-dependent amount.
The page setup now carries both distances — 720, the default
`getDocumentMargins` states, for a theme object that states none — and a
section's own still replace them for that section. Only `w:pgMar`'s `w:header`
and `w:footer` in `word/document.xml` changed, checked part by part against the
previous output of every case on both backends: on docx.js 708/708 became
850/850 in 227 cases, 680/680 in 47, 720/720 in three and 620/620 in three
(office-open's 851/992 became the same values), and in
`structure/page-override-per-section` the section that states 300/300 kept it.
The three that did not move state both distances on every section
(`structure/page-margins-full`, `theme/example-practice-note`,
`theme/example-field-review`). Nothing else reads the distances: the text
measure, the height a percentage image is sized against and a block's page
context take the four edges and the gutter. In LibreOffice the running heads
move by exactly the difference: on the `consulting` `client-report-blocks`
template the head rose and the foot fell 1.4pt with the body unmoved; on
`examples/invoice.docx.json` (`vermilion`) they moved 4.4pt on docx.js and
11.55pt and 18.6pt on office-open, and now land at the same place on both —
its running head had been pushing the body down, so on docx.js the body rose
2.2pt and a table row moved up from the second page. `standard-annual-report`
and `tech-report`, whose running heads are page-anchored artwork, render
pixel-identical. `office-open/__tests__/cross-backend.test.ts` now holds every
section's `w:pgSz` and `w:pgMar` equal across the backends, which 273 corpus
cases failed before, and `__tests__/header-footer-distance.test.ts` pins the
distances per theme and per section on both.

No corpus golden moved when `office-open` started to floor lengths in twips,
and that was measured: every corpus case and the eight DOCX gallery templates
were generated on both backends by the code before and after the change. `docxjs`
did not change. On `office-open` 61 packages did — 59 corpus cases and the
`client-report-blocks` and `technical-report-blocks` templates — in
`word/styles.xml`, the headers and `word/document.xml` only: 126 tracking
values (115 in styles, 9 in running heads, 2 in the runs of
`headings/font-override`) and six margins of the nested `columns` cells in the
three `blocks/text-box-nested-columns*` cases (206.5, 212.5 and 112.5 twips a
side), and flooring those values in the old output makes every part
byte-identical. In LibreOffice `client-report-blocks` now renders
pixel-identical on the two backends, page for page. The lengths left as given
are the ones docx.js writes as given, so the backends agree on them whatever
the IR holds — paragraph spacing, tab stops and text frames — and of those
only a line height reaches a package fractional: a line-height multiple times
240, such as 277.68 twips for 1.157 lines in the annual-report templates or
244.8 for `devportal`'s 1.02-line title, on both backends alike. The compiler
now rounds it, for both; the next paragraph gives that check. `office-open/__tests__/cross-backend.test.ts`
holds every other length in twips whole on each backend over the corpus and
both report templates, which 61 `office-open` cases failed before, and
compares each declared style's tracking across the backends;
`office-open/__tests__/emit.test.ts` pins the floor option by option.

Four goldens moved when the compiler started to round lengths in twips —
`structure/theme-page-source`, `theme/builtin-devportal`,
`theme/overrides-over-named-theme` and `theme/example-field-review`, the
corpus's four `devportal` documents — and the move was checked part by part:
every corpus case and the eight DOCX gallery templates were generated on both
backends by the code before and after the change, and the old code reproduced
all 283 recorded digests first. On each backend the same seven packages
changed, in one part each: the four cases in `word/styles.xml`, where the
Title's `w:line="244.8"` became 245, and `modern-annual-report-2`,
`standard-annual-report` and `vermilion-annual-report` in `word/document.xml`,
in 104, 136 and 59 line heights — twelve values, 277.68 becoming 278, 261.12
261, 235.2 235 and `266.40000000000003` 266 among them. Rounding those values
in the old output to the nearest whole makes every part byte-identical, and
no `w:spacing`, `w:tab` or `w:framePr` length in any package is fractional
now. The multiple is rounded rather than floored: docx.js writes these
attributes as given, so it has no floor here to match, and nearest is what
every other conversion in `ir/units.ts` does. In LibreOffice 26.2 the three
templates and `theme/builtin-devportal`, generated on `docxjs`, render glyph
for glyph as before: 72,400 glyphs over 61 pages, none moved. The lengths an
author states in twips reach the IR as given, and are
rounded the same way now — a tab stop on a paragraph or in a theme style, a
paragraph frame's size and numeric offsets, a statistic's spacing, the gap a
theme sets above a TOC title — as is a theme style's exact or at-least line
height in points, which was multiplied by 20 unrounded. None of them was
fractional in the corpus or the gallery; a block can make one so, since a
`$measure` of half an odd measure is a centre tab at x.5.
`office-open/__tests__/cross-backend.test.ts` now holds paragraph spacing, tab
stops and frames to whole twips on each backend over the corpus and both
report templates, which the four `devportal` cases failed on both before,
and generates one document that states each of those lengths with a fraction
and failed at every one of them.

Every corpus golden moved with docx 9.7.1 → 9.8.0 (#478), and the move was
checked part by part: every corpus case, the eight DOCX gallery templates and
the six `examples/` documents that render on `docxjs` — 296 packages — were
generated on both backends before and after, the old code reproducing all 282
recorded digests first. `office-open` did not change: all 291 of its packages
are byte-identical. On `docxjs` each difference falls in one of sixteen
classes, and normalising those leaves nothing. With the number of packages each
touches:

- `word/theme/theme1.xml` is written, with its relationship and content-type
  override — docx's stock Office theme, byte-identical in all 296
  (dolanmiu/docx#3536). No `docxjs` part names a theme font or colour, so it
  changes nothing this backend draws.
- The empty `word/comments.xml`, its `.rels`, relationship and override are
  gone (282: every package with no comment; dolanmiu/docx#3544).
- `document.xml.rels` renumbers around those two: the theme takes the comments
  part's place, so headers and footers move down one, or, in a commented
  package, fontTable moves up one. Every reference resolves to the same target
  (296).
- `word/styles.xml` no longer carries docx's own `Title` and `Heading1`–`6`
  ahead of the compiler's under the same ids (296; dolanmiu/docx#3543), and
  `Normal` is `w:default="1"` (296; dolanmiu/docx#3554).
- `word/numbering.xml` writes `w:tentative` for `w15:tentative` (296), a
  level's `w:pStyle` after `w:numFmt` where CT_Lvl puts it (8) and `w:lvlJc`
  `left`/`right` for `start`/`end` (1, `lists/level-marker-alignment`), all
  dolanmiu/docx#3543.
- A percentage `w:tblW` is written in fiftieths of a percent, `100%` as `5000`
  (71; dolanmiu/docx#3476).
- A bare `<w:shd w:fill>` gains `w:val="clear"` (15), `w:tblOverlap` moves out of
  `w:tblpPr` to sit beside it (7), and a row's `w:cantSplit` or `w:tblHeader`
  `false` is written `off` (2), all dolanmiu/docx#3543.
- In the 14 commented packages the `w:comments` root declares
  `mc:Ignorable="w14 w15 wp14"` and the comments override follows the fontTable
  and theme overrides (dolanmiu/docx#3543, #3544).
- `wp:docPr` ids in headers and footers continue the body's sequence instead of
  repeating `id="1"` (9: `structure/header-image`, `theme/example-field-review`,
  `theme/example-practice-note` and six gallery templates); body ids are unchanged.
- A tight wrap is written `<wp:wrapTight wrapText="left">` around a
  full-extent `wp:wrapPolygon` where 9.7.1 wrote `distT`/`distB` on an element
  that allows neither, requires the polygon, and lost the side (1,
  `blocks/image-floating-wrap-variants`; dolanmiu/docx#3523). The sides now
  match `office-open`'s. The polygons differ: docx writes the rectangle in
  Word's 21600-unit space, `office-open` in EMUs with a negative height.

In LibreOffice 26.2 the gallery templates, `invoice`, the other examples and
the cases that exercise each class — numbering, cross-references, tight wraps,
row properties, shading, a floating table in a text box, comments — render
glyph for glyph as before: 112,465 glyphs over 161 pages, of which 140 moved.
Those are `contract-v1` and `contract-v2`, whose signature table rises 1pt. It
follows the styles dedupe alone: deleting only docx's `Heading2` from the old
`styles.xml` reproduces it, and changing that definition's size does not, so it
is LibreOffice's reading of a duplicated style id rather than any property
either definition states. What Word made of the duplicates is for the Word
check.

One more golden moved when the compiler stopped dropping a shape's border next
to its fill (`blocks/text-box-shape-fill-and-padding`), on both backends and in
`word/document.xml` only: each gains `<a:ln w="19050">` after its
`a:solidFill`, and the two backends now write byte-identical `wps:spPr` for it.
`docxjs` also widens `wp:effectExtent` from 0 to 38100 EMU a side, as it does
for every inline outlined shape, while `office-open` writes 0. In LibreOffice the
border is drawn, and on `docxjs` the text sits 3pt to the right, which that
extent accounts for.

Every corpus golden moved when the jto theme reached `theme1.xml` (#478), and
only there. Every part of every corpus case, shipped template and example was
dumped on both backends before and after: all 315 `docxjs` packages moved, in
`theme1.xml` and nothing else, and none of the 308 `office-open` packages did.
Once the theme and scheme names, the ten scheme colours and the two Latin fonts
are blanked, every `theme1.xml` is byte-identical too, so hlink, folHlink, the
format scheme and Office's per-script fonts are untouched. That proof says only
what else moved; the values themselves are pinned by
`ir/__tests__/theme.test.ts` and
`renderers/docxjs/__tests__/theme-part.test.ts`. Outside a native chart, nothing
`docxjs` writes names a theme colour or font: every colour and face in
`styles.xml` and `document.xml` is stated, and of the other 5,785 XML and
relationship parts of those packages only the 20 chart parts of the 14 charted
ones refer to the theme. They name slots, as Word's own charts do: a tint of
Text 1 on the gridlines and axis lines, Background 1 on pie and doughnut slice
borders, and the East Asian body font (`+mn-ea`) beside every stated Latin face.
In LibreOffice 26.2 the invoice, the `tech-report`, `technical-report-blocks`,
`client-report-blocks` and `vermilion-annual-report` templates and
`theme/builtin-minimal` and `theme/builtin-devportal` render pixel for pixel as
before: 54 pages, 4,962 words. So do the four `drawings/*` cases,
`native-visual`, `chart/pie` and `chart/doughnut-rings`, whose Background 1 is
white under either theme. The other ten `chart/*` cases,
`blocks/chart-figure-native` and `native-chart` move in their gridlines and axis
lines alone, from a tint of Office's black to one of the jto Text 1 (the
gridlines from grey 217 to 226, 226, 224 on `minimal`): 28,083 pixels at 60 dpi
over 13 pages, all on those lines, the radar's spokes and rings included. What
changes otherwise is what someone editing the document is offered, and what they
insert: a chart, SmartArt or table style added in Word picks up the jto accents.

`office-open` writes Office's theme and takes no option for another, so
`renderers/office-open/themePart.ts` splices the same name, colours and fonts
into it, and `cross-backend.test.ts` holds the two backends' theme parts equal
over the corpus. Dumped the same way, all 308 `office-open` packages moved, in
`theme1.xml` only and there only in the blanked values, and no `docxjs` package
moved; in each of the 308 packages both backends write, the two theme parts now
name the same theme, colours and Latin faces, PANOSE included. Beyond native
charts, this backend refers to its theme where `docxjs` does not: the built-in
styles it adds (Heading 7–9, Quote, Intense Quote, Intense Reference and the
heading, title, subtitle and quote character styles) and the first run of every
contents field name theme colours and fonts. jto content applies none of those
styles and the field run draws no glyph, so in LibreOffice the invoice,
`native-visual`, the `technical-report-blocks`, `tech-report`,
`client-report-blocks` and `vermilion-annual-report` templates,
`headings/toc-default` and `theme/builtin-minimal` render as before, glyph for
glyph and pixel for pixel; in Word they follow the jto theme once someone
applies such a style or updates the field. A native chart names the same slots
as on `docxjs` and moves the same way: against the same package with Office's
theme part, `examples/native-chart` on `vermilion` went from grey 217 to 222,
222, 223 in LibreOffice (3,098 pixels at 60 dpi), the only pixels that moved
over those 56 pages. The corpus's charts move as on `docxjs`, on `minimal` from
217 to 226, 226, 224: 24,471 pixels over 13 pages with `native-chart`, against
28,083 on `docxjs`, whose header and footer charts draw (see Native charts on
docx.js), while its pie and doughnut, the four `drawings/*` cases and
`native-visual` do not move.

Every `office-open` package moved with `@office-open/docx` 0.11.0 → 0.14.6,
and the move was checked part by part: the 308 packages this backend writes
for the corpus, the gallery templates and the examples were dumped before and
after, with the `docxjs` ones beside them. No `docxjs` package moved, nor did
one with docx 9.8.0 → 9.8.1, bumped beside it. On `office-open` each
difference falls in one of seventeen classes, normalising those leaves
nothing, and leaving out any one of them leaves residue. With the number of
packages each touches:

- A false ST_OnOff is written `off` where 0.11 wrote `0` or `false` (308),
  part roots declare namespaces nothing in them uses (308), content-type
  entries, relationships and ZIP parts come in another order (308), and the
  empty `docProps/custom.xml`, its relationship and override are gone (306:
  all but the two packages with a custom property).
- The backend's own `FootnoteTextChar` and `EndnoteTextChar` are 10pt, Word's
  size, where 0.11 wrote 20pt (308), and the bullet list it adds to every
  package states no `w:start` (231). jto applies neither style, and a bullet
  counts nothing.
- A hyperlink drops `w:history="1"` (20), and external hyperlink
  relationships are numbered after the fixed parts (9).
- A paragraph detached from its list drops the `w:ilvl` beside `w:numId 0`
  (2); a revised row marks its paragraph marks inserted or deleted too, as
  docx.js does (2); and in the 7 commented packages `w:comments` declares
  `mc:Ignorable`, and the comment reference run stops naming a
  `CommentReference` style the package never defined.
- In the 14 charted packages a true CT_Boolean is written `val="1"` rather
  than bare, and the pie and the doughnut lose an empty `c:spPr` per series
  (2).
- `chart/in-header-and-footer` (#485): each header and footer carries its own
  chart relationship where 0.11 left an `r:id="{chart:…}"` placeholder, and
  chart parts and workbooks are numbered in another order. The unreferenced
  chart relationship 0.11 also wrote on `document.xml.rels` per such chart
  stays.
- An image drawn at more than one size is one media part (9 packages, 473
  media parts to 428; the 37 copies of one picture in
  `modern-annual-report-3` become one, 148 KB to 4 KB). 0.11 kept a drawing's
  extent on its media entry, so the adapter marked each size's copy apart;
  0.14 keeps it on the drawing. With the marker taken out the copies are
  byte-identical, and every drawing keeps its extent and its picture.

What the adapter now states as options came out as the splices wrote it, byte
for byte once the classes are applied: every chart's look, cell references and
workbook, and a table of contents in a table cell. Three 0.14 regressions are
held off in the adapter and appear in no class. A numbering level that names
no start is given `w:start="1"`, which 0.14 omits, leaving Word and
LibreOffice to count the list from 0. A section that ends on a contents field
ahead of another section gets a bare paragraph for its section properties,
which 0.14 puts inside the field's last entry. And tracking stated as zero is
left out, as docx.js leaves it, since 0.14 writes the zero it is handed, where
0.11 dropped it.

In LibreOffice 26.2 all 308 packages render pixel for pixel as before, 476
pages, but `chart/in-header-and-footer`, whose header and footer charts now
draw where 0.11 left an empty object. In Word 16.113, 61 cases chosen for the
classes and the retired splices — every chart case, numbered and restarted
lists, the contents fields, those in a cell among them, percentage tables,
revisions, comments, notes, images drawn at several sizes and the five annual
reports, 175 pages — render pixel for pixel and text for text as before;
`chart/in-header-and-footer`, which Word would not open, opens with its charts
drawn, and so does `headings/toc-in-text-box`.

## Post-emit rewrite inventory

These are the production sites that edit an emitted OOXML package. Backend
repairs run before generic finalization; changing that order can invalidate a
relationship or make deterministic renumbering miss a newly-added part.

| File                                                              | Ownership / cause                                                                                                                                             | Parts rewritten                                                                                           | Ordering constraint                                                                             |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `packages/shared/src/rendering/chart-parts.ts`                    | Format-neutral chart look stated as `@office-open` options, the workbook XML, and the one splice no option covers (`finishChartXml`: a scatter chart's style) | Chart XML strings (scatter style only), workbook XML and relationship XML consumed by the format adapters | Called by the format adapter before package canonicalization; it never opens a package itself   |
| `packages/core-docx/src/renderers/office-open/chartParts.ts`      | A scatter chart's style on native `office-open` charts; the backend writes each chart's workbook, relationship and content type itself                        | `word/charts/chart*.xml` (scatter charts only)                                                            | Runs before `canonicalizeDocxBuffer`, after the theme splice on the same ZIP                    |
| `packages/core-docx/src/renderers/office-open/themePart.ts`       | The document's theme, which `office-open` always writes as Office's                                                                                           | `word/theme/theme1.xml`                                                                                   | Runs first on the ZIP the chart pass shares, before `canonicalizeDocxBuffer`                    |
| `packages/core-pptx/src/renderers/office-open/chartParts.ts`      | PowerPoint packaging for native `office-open` charts, which the backend embeds no workbook for, and a scatter chart's style                                   | `[Content_Types].xml`, `ppt/charts/chart*.xml`, chart `.rels`, `ppt/embeddings/*.xlsx`                    | Runs before `canonicalizeChartIds`; workbook names and chart references are renumbered together |
| `packages/core-pptx/src/renderers/pptxgenjs/packaging.ts`         | PptxGenJS-only sentinel fills and hard-coded table-style repair                                                                                               | `ppt/slides/slide*.xml`                                                                                   | Runs before generic `finalizePackage`, on the same open ZIP                                     |
| `packages/core-pptx/src/renderers/pptxgenjs/svgRasterFallback.ts` | Replaces PptxGenJS's Node broken-image SVG preview                                                                                                            | PNG media parts paired to SVG picture relationships                                                       | Called from PptxGenJS packaging before generic finalization and timestamp normalization         |
| `packages/core-docx/src/renderers/docxjs/drawingGroupRepair.ts`   | docx.js drawing groups: child `cNvPr` ids, whole-unit `rot`, alt-text and text-box markers                                                                    | Parts that hold a `wpg:wgp`: `word/document.xml`, headers, footers, notes, comments                       | Runs after `fixFloatingImageIds`, before `canonicalizeDocxBuffer`, when the IR holds a group    |
| `packages/core-docx/src/utils/fixFloatingImageIds.ts`             | docx.js-specific `wp:docPr` renumbering, one sequence per package                                                                                             | `word/document.xml`, headers, footers, footnotes, endnotes, comments                                      | Runs after docx.js emits and before `canonicalizeDocxBuffer`                                    |
| `packages/core-docx/src/utils/packageDocument.ts`                 | Generic DOCX relationship-id, embedded-package, metadata and ZIP timestamp canonicalization                                                                   | Relationship parts and owners, embedded packages, `docProps/core.xml`, ZIP entry headers                  | Final DOCX pass, after every backend-specific repair                                            |
| `packages/core-pptx/src/core/finalizePackage.ts`                  | Generic PPTX chart-id, nested-package, core-metadata and ZIP timestamp canonicalization                                                                       | Chart names and references, embedded Office packages, `docProps/core.xml`, ZIP entry dates                | Final PPTX pass, after chart and PptxGenJS-specific repairs                                     |

## Theme foundation golden changes (#328)

`theme/font-numeric-weights` changes intentionally: DOCX theme-level weights now
reach Word styles as synthetic family names and bold/italic flags. All other
existing corpus digests remain unchanged. New `theme/shared-foundation` cases in
both formats cover palette tokens, named roles, canvas scale/spacing and case.
The DOCX case uses vermilion with additive overrides; no bundled theme is restyled.

Both DOCX writers emit only one of caps/smallCaps. Package finalization now adds
the opposite false flag next to the flag already present — `CT_RPr` is an ordered
sequence — allowing `case: none` to reset an inherited case style.
This repair also runs with deterministic output disabled. PPTX case is lowered
to text runs in the compiler; synthetic small caps use 80% size for lowercase
spans. Chrome/motif contracts do not render until #361.

## Source map

| Concern                                             | Path                                                                                           |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Shared renderer contract and capability diagnostics | `packages/shared/src/rendering/`                                                               |
| Format-neutral chart look and workbook              | `packages/shared/src/rendering/chart-parts.ts`                                                 |
| PPTX feature vocabulary                             | `packages/core-pptx/src/ir/features.ts`                                                        |
| PptxIR and compiler                                 | `packages/core-pptx/src/ir/`                                                                   |
| PPTX renderer registry and contract                 | `packages/core-pptx/src/renderers/registry.ts`, `packages/core-pptx/src/renderers/types.ts`    |
| PPTX adapters                                       | `packages/core-pptx/src/renderers/pptxgenjs/`, `packages/core-pptx/src/renderers/office-open/` |
| PPTX generic package finalization                   | `packages/core-pptx/src/core/finalizePackage.ts`                                               |
| PPTX renderer ids and schema pruning                | `packages/shared-pptx/src/schemas/renderer.ts`                                                 |
| DOCX feature vocabulary                             | `packages/core-docx/src/ir/features.ts`                                                        |
| DocxIR and compiler                                 | `packages/core-docx/src/ir/`                                                                   |
| DOCX renderer registry and contract                 | `packages/core-docx/src/renderers/registry.ts`, `packages/core-docx/src/renderers/types.ts`    |
| DOCX adapters                                       | `packages/core-docx/src/renderers/docxjs/`, `packages/core-docx/src/renderers/office-open/`    |
| DOCX generic package finalization                   | `packages/core-docx/src/utils/packageDocument.ts`                                              |
| DOCX renderer ids and schema pruning                | `packages/shared-docx/src/schemas/renderer.ts`                                                 |

Import discipline: only `renderers/pptxgenjs/` may import `pptxgenjs`; only
`renderers/docxjs/` may import `docx`; only `renderers/office-open/` may import
`@office-open/*`. Compiler and IR files import no renderer at all.

### JSON block migration (#340, PPTX)

Five corpus cases carry new goldens: `block/background-and-body`, `block/slots-and-component-props` and `block/row-distribution` replace `template/background-and-objects` and `template/placeholders`; `block/body-page-number` and `block/body-language` replace the template regressions (`template/margin` had no counterpart, since a master margin no longer exists). The playground decks changed deliberately: every slide that used a template now invokes its chrome block as its first child, which moved the quality allowances on `minimalist-pitch-deck` along by one index, and the two purple slides of `data-report-presentation` switched to the paper chrome variant — a contrast defect the once-per-template analysis had hidden and the per-invocation analysis now reports. The consulting deck was rendered through LibreOffice for its shipped contact sheet.

### JSON block migration (#370)

The four report corpus goldens (`key-takeaways-*`, `report-chrome-*`) now use inline definitions copied from the complete playground report. Their hashes deliberately change: generic groups replace privileged named compilers, and template-authored typography/spacing replaces the historical recipes. Other corpus goldens stay unchanged. Native headings, page fields, tracker transitions and explicit section overrides remain covered by tests. The three-page playground report was rendered through LibreOffice for its shipped contact sheet; native Microsoft Word visual testing remains a separate interoperability check.

### Report data blocks (#336)

Two corpus cases are added, `blocks/report-data-consulting` and `blocks/report-data-fallback`, covering `kpi-row`, `callout` and `data-table` from the playground report on the house theme and on `minimal`. No existing golden moves: the evaluator gained operands on `$if`/`$each`/`$count` and maps a repeated element to its authored item, neither of which changes what an existing definition emits.

### Figures and footnotes (#337)

Two corpus cases are added, `blocks/figures-consulting` and `blocks/figures-fallback`: numbered `figure` captions over `source-line`s and the `footnotes` list, on the house theme and on `minimal`. No existing golden moves. The `{SEQ:name}` placeholder is new syntax — a `SEQ name \* ARABIC` field written by both renderers with the compiler's count as its cached result (docxjs as a split complex field, office-open as `w:fldSimple`) — so no document that never used it changes. `chart-figure` had no golden: a `highcharts` chart needs the export server and a native `chart` then needed the office-open renderer, and the corpus runs one service-free pipeline. Since #478 the default renderer draws the native chart, and `blocks/chart-figure-native` records it.

### Column layout inside blocks (#343)

Seven corpus goldens move: `blocks/report-data-consulting`,
`blocks/report-data-fallback`, `blocks/figures-consulting` and the four
`blocks/text-box-nested-columns*` cases. Two changes, both found by the block
boundary matrix rendering a KPI row after a paragraph through LibreOffice:

- `compileColumns` now writes the table grid (`w:tblGrid`) from the column
  widths, each cell its column plus half of each gap beside it, so the cells
  sum to the measure. Without a grid docx.js wrote a 100-twip `gridCol` per
  column, and LibreOffice sizes a fixed-layout table from its grid.
- The layout stage no longer declares a section multi-column because a
  container inside it holds a `columns` component. A nested `columns` — in
  a group, a text box or a block — compiles to a table; wrapping that table
  in a two-column newspaper section drew a KPI row at half the measure with
  the following paragraph flowing up beside it whenever any paragraph
  preceded the block. Only a top-level `columns` decides a section's
  column layout, as before.

Byte changes are the grid values and the removed section break; content,
styles and chrome are unchanged. The grid is rounded to whole twips, the last
cell absorbing the remainder so the cells still sum to the measure; the
three `text-box-nested-columns*` cases with a percentage gap moved a second
time for that, and `text-box-nested-columns-floating` a third: stated widths
that fill the measure plus a gap are scaled back so the grid never exceeds
the table (the top-level path refuses such a configuration outright).

The same matrix moved the report block goldens (`blocks/report-chrome-*`,
`blocks/report-data-*`) through the playground template rather than the
engine: the cover's title and subtitle now carry their own line spacing
(1.1) and paragraph spacing instead of inheriting the theme's body values,
so a twelve-word title on `minimal` no longer pushes the whole keep-together
chain onto a second page; a KPI row of four sets its statistics `small`;
every data-table row is `cantSplit`, so a wrapped label never straddles a
page break; and the data-table states its own horizontal cell padding (the
label column flush left, six points between columns, figures flush right),
because a theme that sets only top and bottom padding pins the other two
sides to zero and adjacent right-aligned headers ran into each other.

### Section bookmark anchors (#360 checkpoint)

Every DOCX corpus golden that carries a section moves (150 of 283). The
docx.js renderer used to open a section's bookmark in a zero-spacing paragraph
before the first block and close it in a bare Normal paragraph after the last
one. The closing paragraph cost a line, and on a section whose last page was
already full that line became an empty page carrying nothing but the running
head and footer — the defect the client-report checkpoint judge named in ten
of twenty-four rationales. Both anchors now ride inside the edge paragraphs
(`w:bookmarkStart` before the first run, `w:bookmarkEnd` after the last); a
section that begins or ends with a table gets a one-point exact paragraph
(`w:line="20" w:lineRule="exact"`, no spacing) instead. The office-open
renderer already wrote the anchors as section children and does not change.

In the same release `withChartTypography` writes `credits.enabled: false`
beneath the author's Highcharts options in both formats, so the
`highcharts.com` credit no longer lands in the plot area of a report chart
(thirteen rationales). An authored `credits.enabled: true` still wins. No
corpus golden carries a rendered chart, so no golden moves for it.

### Alternate themes on the shared layers (#330)

Seven DOCX corpus goldens move, every case set on `vermilion` or `devportal`
(`theme/builtin-vermilion`, `theme/builtin-devportal`,
`theme/example-field-review`, `theme/shared-foundation`,
`theme/overrides-over-named-theme`, `structure/theme-page-source`,
`structure/page-override-per-section`). Both themes now carry the shared
visual layers `consulting` carried alone: `resolveDocxDesignSystem` writes a
style per type role (`display`, `stat`, `eyebrow`, `label`, `tracker`,
`source` and the rest) into `styles.xml`, sets `Normal`'s paragraph spacing to
the theme's block gap, and writes the canvas safe area into the section
margins — 0.8in all round on `vermilion` (was 0.94in top and bottom, 0.82in
sides), 0.75in on `devportal` (was 1in top and bottom). The theme files state
the same margins under `page`, so the two layers agree. A section that
overrides its page keeps its override, which is why
`page-override-per-section` moves only in the sections that inherit. Nothing
about a document's content or its authored styles changes; a document that
names neither theme is untouched.

### Table cell content

One DOCX corpus case is retired, `tables/unsupported-nested-component`, with
its golden; no other golden moves. It rendered a `list` and a `heading` in
table cells as the compiler's grey `[Unsupported component type: …]` run, and
validation now refuses such a document (`unsupported_cell_content`): a cell
holds a string, a `paragraph`, an `image`, a `visual` or a `highcharts`
chart, and the live schema says so. The corpus holds documents that validate,
so the fallback moved to `__tests__/table-cell-content.test.ts`, which renders
it on both backends. The run is unchanged; what changed is that the compiler
now also warns `W_UNSUPPORTED_CELL_CONTENT` for each cell that paints it,
naming the cell, since the only documents still reaching it went round
validation — a plugin's output, a caller with validation off.
