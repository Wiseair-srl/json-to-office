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
advertised `>=20` engine range so neither claim is only theoretical.

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
| `masters`               | Authored slide masters.                    | yes         | —             |
| `placeholders`          | Named master placeholder regions.          | yes         | —             |
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

| Feature                                      | `pptxgenjs`                                            | `office-open` (0.11.0, verified against the package)                                                       |
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
| `drawing-groups`     | Grouped DrawingML shapes and pictures.         | —        | yes           |
| `charts`             | Native charts with embedded workbooks.         | —        | yes           |
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

`@office-open/docx` 0.11.0 is not a thin wrapper — it is a second full
implementation with the same option vocabulary as docx.js, taken as plain JSON
rather than an object graph. That is why the adapter is a sibling of the
docx.js one rather than a translation layer on top of it.

| Feature                             | `docxjs`                                              | `office-open` (0.11.0, verified against the package)                                |
| ----------------------------------- | ----------------------------------------------------- | ----------------------------------------------------------------------------------- |
| paragraphs, runs, styles, numbering | yes                                                   | yes                                                                                 |
| sections, columns, headers, footers | yes                                                   | yes, including `first` and `even` parts                                             |
| tables, floating tables             | yes                                                   | yes                                                                                 |
| merged cells                        | `verticalMerge` / `columnSpan`                        | the same two, spelled identically                                                   |
| inline and floating images          | yes                                                   | yes                                                                                 |
| SVG with a raster fallback          | yes                                                   | yes — `PictureOptions` has an `svg` type with a `fallback`, unlike its pptx sibling |
| text boxes (`wps:wsp`), text frames | yes                                                   | yes                                                                                 |
| drawing groups (`wpg:wgp`)          | **no** — docx.js has no group primitive               | yes — a paragraph-level `wpgGroup` run taking shape, group and picture children     |
| footnotes, endnotes                 | yes                                                   | yes                                                                                 |
| native charts                       | **no** — docx.js has no chart primitive               | yes, with an embedded workbook spliced in — see below                               |
| comments                            | yes                                                   | yes, but flat — see below                                                           |
| revisions                           | one `w:ins`/`w:del` per run                           | a real wrapper element, so the id appears once per range                            |
| fields                              | a run child per known instruction, plus `w:fldSimple` | `simpleField` takes any instruction with its cached result                          |
| table of contents, cached entries   | title/level pairs, entry paragraphs built internally  | fully-built entry blocks, so this adapter writes them                               |
| run size                            | half-points                                           | **points** — the backend doubles what it is given                                   |
| cell margins                        | `{marginUnitType, top, …}`                            | `{top: {size, type}, …}`                                                            |
| `wp:docPr` ids                      | duplicated, repaired after packaging                  | a **module-level counter** — see below                                              |

`@office-open/docx` numbers `wp:docPr` from `_docPropsIdGen`, a module-level
generator, whenever a drawing does not state an id. That is process-global: the
same document rendered twice came out with different ids, and two rendered at
once interleaved — 38 of the 272 corpus cases were byte-unstable because of it.
The adapter therefore states an id on every drawing, allocated per render in
document order. docx.js has the mirror-image problem — it _duplicates_ ids
(dolanmiu/docx#2719) — and is repaired by renumbering the packaged
`document.xml`. Both are covered by `__tests__/document-isolation.test.ts`,
which renders a document carrying a picture, a shape and a header image twice
and concurrently, on both backends.

Deliberately **not** declared, so a document using them fails before rendering
rather than losing content:

| Feature                                                            | Why                                                                                                                                                       |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `comment-threads`                                                  | `CommentOptions` is `{id, author, initials, date, children}` — no parent, no resolved state, so a reply would flatten into an unrelated top-level comment |
| `table-merged-cells`, `cached-fields`, `shading`, `borders`, `rtl` | the vocabulary no lowering covers yet, so nothing can require them; both adapters leave them out so a declared set means "proven by a test"               |

`docxjs` withholds two capabilities of its own: `drawing-groups` and `charts`.
Both are real backend gaps rather than slice boundaries — docx.js has no
`wpg:wgp` and no chart primitive at all — and they are what turn a natively
drawn `visual` or a `chart` handed to the default backend into a named
capability error rather than a document with the figure missing.

### Native charts

`@office-open/docx` has a chart run, and it writes less than its types promise.
`ChartOptions extends ChartSpaceOptions`, but the run forwards only eight of
those fields to `chartSpaceDesc` — `type`, `title`, `series`, `categories`,
`showLegend`, `style`, `threeD`, `view3D` — and drops the rest. Verified against
the package, which is the only way this was ever going to be found: the types
say otherwise. Three of the dropped options are visible to whoever opens the
document.

| Dropped        | Symptom in Word                                                                                     |
| -------------- | --------------------------------------------------------------------------------------------------- |
| `externalData` | Every `<c:f>` is emitted empty, so the chart caches values with no source and **Edit Data** fails   |
| series fill    | Nothing on `ChartSeriesCommon` or `DataPointOptions` carries one, so every series ignores the theme |
| `axes`         | Default `c:catAx`/`c:valAx` are written, but an authored axis title never reaches them              |

`chart-parts` in `@json-to-office/shared/rendering` splices all three into the
emitted package after generation: the workbook part and its relationship,
`c:externalData`, the real cell references in place of the empty `<c:f/>`, a
`c:spPr` solid fill per series, and a `c:title` in each axis. Editing another
library's serialisation is not free and is chosen deliberately — the alternative
is a chart that draws and then fails on the first double-click. The pptxgenjs
adapter reaches for the same technique for gradient and pattern fills.

That module also builds the xlsx, because nothing in `@office-open/core` does:
`ExternalDataOptions` is `{relationshipId, autoUpdate}`, a pointer, and
`XLSX_PARTS` is an OPC validation manifest rather than a writer.

It is shared because a `c:chartSpace` is DrawingML and reads the same in either
format. The two backends omit **different amounts** of it, so every repair is
guarded on what the XML actually lacks rather than applied blind:

| Omitted          | `@office-open/docx`             | `@office-open/pptx`             |
| ---------------- | ------------------------------- | ------------------------------- |
| legend position  | yes                             | no — forwarded                  |
| `c:externalData` | yes                             | yes                             |
| axis titles      | yes                             | yes                             |
| bar grouping     | yes — always `clustered`        | yes — always `clustered`        |
| cell references  | yes — every `<c:f>` is empty    | yes — every `<c:f>` is empty    |
| series fill      | yes — every `<c:spPr>` is empty | yes — every `<c:spPr>` is empty |

The difference is one line in each backend: the docx chart run forwards eight
named fields of `ChartSpaceOptions` to `chartSpaceDesc`, while the pptx chart
descriptor hands it the whole options object — which buys less than it sounds
like, because most of what is missing has no `ChartSpaceOptions` field to be
forwarded _from_. `axes` is the exception and is deliberately not passed: it
replaces the backend's default axis pair wholesale and requires ids the adapter
cannot allocate, so a partial one emitted literal `<undefined>` elements.

Two repairs are shape-dependent rather than uniform. A pie or doughnut is
coloured per data point, so the splice writes one `c:dPt` per slice instead of a
series fill — a series fill paints every slice the same colour. And a scatter
chart has no `c:catAx` at all: both its axes are `c:valAx`, X first, so its axis
titles are placed by position rather than by tag.

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

| Capability              | Reaches the file by                                                      |
| ----------------------- | ------------------------------------------------------------------------ |
| `chart-bar-style`       | forwarded — `gapWidth`, `overlap`                                        |
| `chart-pie-style`       | forwarded — `holeSize`, `firstSliceAngle`                                |
| `chart-data-labels`     | forwarded — per-series `dataLabels`, all six flags written explicitly    |
| `chart-line-style`      | forwarded `smooth`/`marker`; `lineSize` spliced into `c:ser/c:spPr/a:ln` |
| `chart-data-border`     | spliced — an `a:ln` beside the fill, or on each `c:dPt` of a pie         |
| `chart-radar-style`     | spliced — `c:radarStyle`, which the backend writes from a literal        |
| `chart-axis-scale`      | spliced — `c:scaling` bounds, `c:majorUnit`, `c:numFmt`                  |
| `chart-axis-visibility` | spliced — `c:delete`, and an `a:noFill` line                             |
| `chart-axis-style`      | spliced — `c:majorGridlines`, label rotation                             |
| `chart-text-style`      | spliced — `a:defRPr` in the title, legend, data labels and axis `c:txPr` |

Everything spliced is spliced because `AxisOptions` cannot be passed at all —
supplying `axes` replaces the backend's default pair and needs `id`/`crossAxisId`
values an adapter cannot safely allocate, and a partial one emits literal
`<undefined>` elements. The axis is therefore rebuilt rather than patched:
CT_CatAx and CT_ValAx fix the order of their children — `majorGridlines`,
`title`, `numFmt`, `spPr`, `txPr`, all between `axPos` and `crossAx` — and
inserting each edit at its own anchor put whichever landed last in front of the
rest.

`pptxgenjs` declares all ten and already forwarded every one of these props, so
the split cost no deck that rendered before. Only `bubble` on office-open stays
refused, for the reason above.

Each core keeps its own packaging: `word/charts` and `word/embeddings` with
adm-zip on one side, `ppt/charts` and `ppt/embeddings` with jszip on the other.
The pptx workbook is named `Microsoft_Excel_Worksheet{N}.xlsx` because that is
what pptxgenjs writes and what `canonicalizeChartIds` renumbers — which is also
why the splice has to run _before_ finalization rather than after.

The chart run also has the `wp:docPr` problem described above, and the same
cure: the adapter states an id on every chart drawing, because an unnamed one is
numbered from the process-global `_docPropsIdGen` and made two renders of one
document differ.

### Native visuals

A `visual` is normally rasterized: it becomes a one-slide PPTX, LibreOffice
draws it, and the PNG is embedded as an `image` — all of it before the compiler
sees the tree. `renderMode: "native"` takes a different path entirely. The
component survives desugaring, the compiler lowers it to a
`DocxIrDrawingGroupRun`, and the office-open adapter emits one `wpg:wgp`. No
PPTX, no rasterizer request, no pre-pass counter moves.

The IR node is backend-neutral by construction: it says what is drawn and where
(EMU frames in the group's own child coordinate space, resolved colours,
registered picture resources), never how. The gate is the ordinary capability
one, so IR that reaches `docxjs` by some other route is refused rather than
dropped.

Native mode is strict on purpose. Its element model — `text`, `shape`, `image`
— is narrower than the PPTX slide-content union, and every native schema is
`additionalProperties: false`, so a gradient fill or a chart element is a
validation error instead of a silent omission. `collectDocxRendererErrors`
carries the two rules a schema cannot: `renderMode: "native"` under any other
renderer is reported at the component's `props/renderMode`, and an element kind
with no native form at `props/elements/N/name`.

Native cases stay out of the shared corpus — every corpus case is rendered by
the default backend, which refuses a group — and live in
`__tests__/native-visual.test.ts` instead, which asserts the emitted DrawingML,
the absence of any rasterizer contact, byte determinism across sequential and
concurrent renders, and the docxjs refusal. `libreoffice-smoke.test.ts` opens
one for real.

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

### Packaging notes for `@office-open/*`

ESM-only, no `require` condition, no peer dependencies, no install scripts, no
native code (7.4 MB across 6 packages) — which is what makes them cheap enough
to be ordinary `dependencies` of the two cores rather than optional peers.

They were optional peers until an integration run showed what that cost: under
`npx`, where nobody has a project to `pnpm add` into, `office-open` was
advertised by `jto_info`, `jto_discover` and `jto_validate` and installed by
none of them, so the only way to discover it could not run was to fail a render
— and with it the `visual` component's `renderMode: "native"`, which is
documented as needing that backend. Installed by default, and reported with
`available` beside the id, both halves of that are gone.

Two constraints matter:

- `@office-open/core` uses a top-level `await import('node:zlib')`, so anything
  bundling it cannot be emitted as CJS.
- `@office-open/core` is a de-facto direct dependency of a PPTX adapter: the
  drawing and theme option types live there and are only partly re-exported.
- `@office-open/docx` re-exports `MediaTransformation` and `Floating` from
  `@office-open/core`, which does not declare them. Referencing those types
  directly would not compile; the DOCX adapter does not, because it builds plain
  option bags.

## Recorded output differences

Everything else is identical part for part, checked case by case against the pre-IR
implementation. These are the deliberate exceptions.

### PPTX

| Change                                                                                                   | Why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A text box with a named `style` and no coordinates lands in a band for that style rather than at (0, 0). | Named styles carried type and no position, and every positionless element resolved to the origin — so a `title` and a `subtitle` on one slide drew on top of each other in the top-left corner, which is the shape both shipped starters had. Bands are fractions of the slide extent, so they hold at any aspect. Each axis is decided on its own: a stated `x` still wins for `x`. An unstyled text box keeps the origin. Two positionless boxes that still overlap — two of the same style — are reported as `TEXT_OVERLAP_UNPOSITIONED` rather than moved; moving one is a layout engine's job (#220). |
| A table draws a border and sets its first row apart.                                                     | With no `componentDefaults.table` in any bundled theme, a table was bare text in columns: no rule anywhere, nothing marking the header. The themes now state a border and `headerRow: true`. Every part of the header treatment yields to something the author said — a cell's own fill or weight, or a table-wide `fill`/`color`. Deliberately no `margin`: cell insets are a capability `office-open` refuses, and a default every table inherited would have turned a working backend into one that fails every table.                                                                                  |
| A number in `[20, 100)` used as a table `x`/`y`/`w`/`h` now means inches, as it does everywhere else.    | The backend's table path used a different inch/EMU threshold (20) from the rest of its API (100), so the same authored number meant different things depending on which component it was on. The compiler applies one rule. The affected range is meaningless under either reading (20–100 inches, or 20–100 EMU ≈ 0.0001").                                                                                                                                                                                                                                                                               |
| `underline: false` no longer underlines.                                                                 | The pre-IR writer treated any boolean as "underline", so `false` turned it on.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `bullet: { type: 'bullet' }` now produces a bullet.                                                      | The object form was passed through in a shape the backend ignored, so an authored bullet silently did nothing. The boolean form always worked.                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `bullet: false` no longer produces a bullet.                                                             | Every boolean lowered to an enabled bullet, so an explicit "no bullet" could not override one inherited from a style. `{ type: 'number' }` with no other field now numbers instead of clearing the bullet. A single-BMP custom glyph reaches both backends; PptxGenJS refuses astral and multi-code-point glyphs instead of silently substituting `•`.                                                                                                                                                                                                                                                     |
| A four-value `margin` keeps the schema's `[top, right, bottom, left]` order.                             | PptxGenJS's text path reads those four numbers as `[left, right, bottom, top]`, disagreeing with its own table path, and the office-open adapter read them as `[left, top, right, bottom]`. Both are corrected in the adapter; a symmetric margin is unaffected, which is why nothing in the corpus moved.                                                                                                                                                                                                                                                                                                 |
| A rounded table positioned with percentages now gets its rounded backdrop.                               | The backdrop was drawn only when `x` and `y` happened to be plain numbers, so a percentage-positioned rounded table came out square. The IR always carries a resolved absolute origin.                                                                                                                                                                                                                                                                                                                                                                                                                     |
| A `highcharts` component inside a template placeholder is now rejected rather than rendered.             | Placeholder content is merged with its declaration during compilation, so expanding the chart beforehand would size it from pre-merge dimensions. Failing is better than rendering it at the wrong size; slide- and template-level highcharts are unaffected.                                                                                                                                                                                                                                                                                                                                              |

Image `sizing` and aspect-ratio auto-fill moved into a pre-pass rather than
being split between the writer and the backend, but the results are unchanged —
the corpus cases for `contain`, `cover` and the auto-fill were recorded from the
old implementation and still pass.

`transition` is lowered now, so it is no longer authored-but-ignored. It reaches
the package through `office-open`, and PptxGenJS — which has no transition API —
refuses a deck that asks for one rather than dropping it. A `transition` of
`none` lowers to nothing, because OOXML says "no transition" by omitting the
element, so it asks nothing of either backend.

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

| Change                                                                                | Why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A header or footer whose components are all `enabled: false` breaks link-to-previous. | It used to compile to no part at all, which is how Word spells "inherit", so a section that explicitly disabled its chrome showed the previous section's — stale or confidential content included. Disabling everything is a statement about this section, exactly like an explicit empty array.                                                                                                                                                                                                                                              |
| An SVG in a first-page or even-page part ships a real raster fallback.                | The adapter's image walk read only the `default` chrome slot, so such an SVG got its own bytes labelled `image/png` as the fallback, and the section options dropped the part outright.                                                                                                                                                                                                                                                                                                                                                       |
| A shape-mode `text-box` keeps its padding and its border colour on `office-open`.     | The adapter spelled the insets `topInset`/`bottomInset`/`leftInset`/`rightInset` and nested the outline colour under `outline.fill`. `a:bodyPr` takes `lIns`/`tIns`/`rIns`/`bIns` (or a `margins` object), and `OutlineOptions` carries its colour at the top level — no `*Inset` key exists anywhere in the package, and a nested `fill` is ignored. Both values were accepted and then dropped, so every shape text box drew with default insets and a default-coloured border. `docxjs` always had them right; the two backends now agree. |

| A `statistic` renders its `unit`, `size`, `trend` and `trendValue`, under two styles the document now defines. | All four props were declared, accepted by the schema and read by nothing: `{ "number": "99", "unit": "%" }` rendered `99`, and the shipped `docx-report` starter lost its percent sign with no diagnostic anywhere in the pipeline. The two paragraphs also named `StatisticNumber` and `StatisticDescription`, which no theme and no generator ever defined — an undefined `w:pStyle` resolves to Normal in silence, so the component purpose-built for KPIs set at body size and weight. The styles are appended only to documents that contain a statistic, so nothing else moved. `format` stays unimplemented and now warns (`W_STATISTIC_FORMAT_IGNORED`) rather than vanishing. |
| A body paragraph or list item directly under a table gets 120 twips above it. | OOXML gives a table no space-after — the property does not exist — so the block below one drew hard against its bottom rule. A heading was already spaced by its own style and is left alone; only styles that contribute nothing of their own are topped up. |
| A list marker sits inside the text margin. | Every bundled theme set `componentDefaults.list.indent: 3`. That field is points, so level 0 compiled to `w:ind w:left="60" w:hanging="360"` — a marker 300 twips to the _left_ of the page margin, outdented past the body text it labels. The themes no longer state it, so the per-level default (720/360, Word's own) applies. `IndentSchema` now documents its unit; the neighbouring `ParagraphIndentSchema` is twips, and neither said so. |
| The `theme/example-proposal` and `theme/example-technical-guide` goldens moved because the documents changed, not the pipeline. | The shipped `proposal` and `technical-guide` templates were rebuilt at stock-template fidelity: a full-bleed SVG cover section with page-anchored floating text, an inline-SVG brand band and a real architecture diagram. The rebuild also removed the templates’ `placehold.co` image URLs — the only remote fetches in any shipped document — so rendering them no longer needs the network. They moved again when both documents were restyled onto the bundled `vermilion` theme, the design system shared by the `vermilion-annual-report` stock template and the runnable examples. |
| A table border side named on a cell or column now always renders, and no contested interior edge leaves the compiler (`tables/borders-per-side` and `tables/borders-zero-size` moved; `tables/borders-edge-ownership` pins the rules). | Adjacent cells each carry half of a shared edge, and the halves could disagree — a cell's named red `right` against the neighbour's inherited grey `left`. Word resolves that conflict by ECMA-376 §17.4.66's weight rules (wider, then darker by `R+B+2G` → `B+2G` → `G`) and drew the red; LibreOffice resolves it its own way and drew the grey — so the playground's LibreOffice-rendered PDF preview contradicted the downloaded file, and the `vermilion-annual-report` tables had to state both halves of every internal edge to be safe. The table model now adjudicates every interior edge — a named side beats an inherited one, equals fall to the same §17.4.66 rules — and mirrors the winner onto both cells, so every consumer draws the same edge. `hideBorders` also stopped silencing named sides: hiding is a table-level statement, and the cell and column layers already outrank the table everywhere else. Scalar `borderColor`/`borderSize` stay restyling knobs that claim no side. |
| An object-form table-level `borderColor`/`borderSize` now survives a theme whose `componentDefaults.table` states a scalar for the same key (part of the `tables/borders-per-side` move). | `mergeWithDefaults` recursed into the theme default even when it was a scalar, so `deepMerge('#f0f0f0', { top: 'FF0000' })` spread the string into `{0:'#',1:'f',…}` and the author's per-side object was silently destroyed — the old golden pinned black fallback borders where the document stated red and blue ones. The merge now lets a user object replace a non-object default outright. |
| An inline SVG containing `<text>` keeps the vector-only fallback (`theme/example-proposal` and `theme/example-technical-guide` moved). | Text rasterizes with whatever fonts the generating machine offers, so the same document produced different fallback PNG bytes on macOS, Linux and Windows — the first text-bearing template SVGs made these two goldens platform-dependent, recorded on one OS and failing on the others. The raster fallback is skipped for text-bearing SVGs with an `IMAGE_SVG_RASTER_SKIPPED` warning, the same route the pixel-budget sliver check already takes; Word 2016+ and LibreOffice draw the vector regardless, and a portable fallback wants the text as paths. |
| A backslash escapes the inline mini-language, so `\_`, `\*`, `\[`, `\]`, `\{`, `\}` and `\\` render as themselves (`text/decorators-edge-cases` moved). | A code sample was unwritable. `grant_type=client_credentials` has two underscores, so the parser read the span between them as emphasis and the reader got _granttype=clientcredentials_ — visible in the shipped `technical-guide` for as long as it had code in it. Escapes are swapped for private-use sentinels before any pass runs and swapped back where authored text becomes runs, so no later pass can mistake one for markup. A backslash before anything else stays a backslash, which is why only the one corpus case that deliberately wrote `\*` moved. `parseLiteral` does not unescape: the paths that promise character-for-character output still give one. |
| The `theme/example-proposal` and `theme/example-technical-guide` goldens moved again, with both documents rebuilt from scratch. | The two shipped templates were re-authored against the `vermilion-annual-report` stock template as the reference: its display-heading scale, its hairline tables with a single accent rule and flush-left first column, its muted body colour and tinted emphasis rows. The structural change worth knowing is that each numbered part is no longer its own Word `section`. A section exists to change page setup or chrome, these parts change neither, and a section ends with the empty paragraph that carries its break — which produced a blank page whenever a part happened to fill its last page. Both documents now use three sections (cover, body, back cover) and put `pageBreak` on each part's opening paragraph instead. |
| `theme/example-technical-guide` moved once more: the guide changed theme. | The two shipped documents were reading as one house style, which is not what a pair of examples is for. The proposal keeps `vermilion`; the integration guide moved to the bundled `devportal` theme — cool slate, one teal accent, monospace where the reader is expected to type — which until now no shipped document used. The composition rules carried over unchanged (hairline tables, flush-left first column, short tables held whole, no page under 70% full); the dressing did not: the section index is monospaced, headings are set solid over the theme's own accent rule instead of large and light, table headers are a shaded band rather than an accent vertical rule, and code sits in a closed fence. Page geometry moved with the theme — `devportal` margins give a 487.3pt measure against `vermilion`'s 477.3pt — so every fixed column width and every page break was re-checked. |

No corpus golden moved for the text-box fix: the goldens record the _default_
backend's bytes, and `docxjs` was already correct. The two spellings are pinned
directly in `renderers/office-open/__tests__/emit.test.ts` instead, which is
where a difference between the backends' option vocabularies belongs.

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

## Post-emit rewrite inventory

These are the production sites that edit an emitted OOXML package. Backend
repairs run before generic finalization; changing that order can invalidate a
relationship or make deterministic renumbering miss a newly-added part.

| File                                                              | Ownership / cause                                                                             | Parts rewritten                                                                            | Ordering constraint                                                                              |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| `packages/shared/src/rendering/chart-parts.ts`                    | Format-neutral repair for chart XML and workbook data omitted by both `@office-open` backends | Chart XML strings, workbook XML and relationship XML consumed by the format adapters       | Called by the format adapter before package canonicalization; it never opens a package itself    |
| `packages/core-docx/src/renderers/office-open/chartParts.ts`      | Word packaging for native `office-open` charts                                                | `[Content_Types].xml`, `word/charts/chart*.xml`, chart `.rels`, `word/embeddings/*.xlsx`   | Runs before `canonicalizeDocxBuffer` so new parts and relationships are included in finalization |
| `packages/core-pptx/src/renderers/office-open/chartParts.ts`      | PowerPoint packaging for native `office-open` charts                                          | `[Content_Types].xml`, `ppt/charts/chart*.xml`, chart `.rels`, `ppt/embeddings/*.xlsx`     | Runs before `canonicalizeChartIds`; workbook names and chart references are renumbered together  |
| `packages/core-pptx/src/renderers/pptxgenjs/packaging.ts`         | PptxGenJS-only sentinel fills and hard-coded table-style repair                               | `ppt/slides/slide*.xml`                                                                    | Runs before generic `finalizePackage`, on the same open ZIP                                      |
| `packages/core-pptx/src/renderers/pptxgenjs/svgRasterFallback.ts` | Replaces PptxGenJS's Node broken-image SVG preview                                            | PNG media parts paired to SVG picture relationships                                        | Called from PptxGenJS packaging before generic finalization and timestamp normalization          |
| `packages/core-docx/src/utils/fixFloatingImageIds.ts`             | docx.js-specific duplicate `wp:docPr` id repair                                               | `word/document.xml`                                                                        | Runs after docx.js emits and before `canonicalizeDocxBuffer`                                     |
| `packages/core-docx/src/utils/packageDocument.ts`                 | Generic DOCX relationship-id, core-metadata and ZIP timestamp canonicalization                | Relationship parts and owners, `docProps/core.xml`, ZIP entry headers                      | Final DOCX pass, after every backend-specific repair                                             |
| `packages/core-pptx/src/core/finalizePackage.ts`                  | Generic PPTX chart-id, nested-package, core-metadata and ZIP timestamp canonicalization       | Chart names and references, embedded Office packages, `docProps/core.xml`, ZIP entry dates | Final PPTX pass, after chart and PptxGenJS-specific repairs                                      |

## Source map

| Concern                                             | Path                                                                                           |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Shared renderer contract and capability diagnostics | `packages/shared/src/rendering/`                                                               |
| Format-neutral chart post-processing                | `packages/shared/src/rendering/chart-parts.ts`                                                 |
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
