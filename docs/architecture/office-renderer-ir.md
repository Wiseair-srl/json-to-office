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
  `spacingTwips`)
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

| Feature                                      | `pptxgenjs`                                            | `office-open` (0.11.0, verified against the package)                                                       |
| -------------------------------------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| masters, layouts, placeholders               | yes                                                    | yes                                                                                                        |
| slides, slide size, theme                    | yes                                                    | yes                                                                                                        |
| text bodies, rich runs, paragraph properties | yes                                                    | yes (no `txBox="1"` is ever emitted — a text box renders as a shape)                                       |
| images (raster)                              | yes                                                    | yes                                                                                                        |
| SVG images                                   | yes (raster fallback repaired during packaging)        | **no** — `PictureOptions.type` excludes `svg`, and no code path creates an SVG media entry                 |
| preset shapes                                | yes                                                    | yes, but `preset` is a free-form string with no validation                                                 |
| transforms — position/size                   | yes                                                    | yes                                                                                                        |
| transforms — rotation                        | yes                                                    | shapes and groups only; `PictureOptions` has no `rotation`, which is why `image-transform` is not declared |
| transforms — flip                            | yes                                                    | `flipHorizontal` only; `flipVertical` is not on any pptx option type                                       |
| solid / gradient / pattern fills             | yes (gradient and pattern via a sentinel + XML splice) | yes, natively                                                                                              |
| image fills                                  | **no** — no shape image-fill API                       | yes                                                                                                        |
| lines, shadows                               | yes                                                    | yes                                                                                                        |
| tables incl. merged cells                    | yes                                                    | yes                                                                                                        |
| native charts                                | yes, with an embedded workbook                         | chart XML only — **no embedded workbook**, so "Edit Data" fails                                            |
| hyperlinks (external + slide)                | yes                                                    | yes                                                                                                        |
| speaker notes, hidden slides                 | yes                                                    | yes                                                                                                        |
| transitions                                  | **no** API                                             | yes                                                                                                        |
| groups                                       | **no** API                                             | yes                                                                                                        |
| RTL                                          | deck-level                                             | deck- and paragraph-level; run-level `rightToLeft` is declared but never emitted                           |

### What the office-open PPTX adapter declares

Supported and mapped: text bodies and rich runs, paragraph properties, preset
shapes, images, solid/gradient/pattern/image fills, lines, shadows, plain
tables, backgrounds, speaker notes, hidden slides, transitions, groups,
external and slide hyperlinks, shape rotation, horizontal flip, proofing
language, RTL.

Deliberately **not** declared, so a document using them fails before rendering
rather than losing content:

| Feature                   | Why                                                                                                            |
| ------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `svg`                     | `PictureOptions.type` excludes SVG and nothing creates an SVG media entry                                      |
| `charts`                  | chart XML ships without its embedded workbook, so "Edit Data" fails                                            |
| `image-rotation`          | `PictureOptions` has no `rotation`; it would be discarded                                                      |
| `flip-vertical`           | no pptx option type carries it                                                                                 |
| `masters`, `placeholders` | the backend supports them; the mapping is not written, and an unmapped master would drop every template object |
| `table-merged-cells`      | the backend marks merges as `restart`/`continue` on covered cells while the IR carries span counts             |

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
| footnotes, endnotes                 | yes                                                   | yes                                                                                 |
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
them against `@office-open/docx` would put an optional peer dependency into this
package's published `.d.ts`.

`office-open` findings come from reading the shipped types and compiled source
and from generating, unzipping and rendering real files — not from its README.
Anything not proven by a test stays out of the adapter's capability set, so it
fails loudly instead of producing a document with content missing.

### Packaging notes for `@office-open/*`

ESM-only, no `require` condition, no peer dependencies, no install scripts, no
native code (7.4 MB across 6 packages) — safe as an optional dependency.
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

| Change                                                                                                | Why                                                                                                                                                                                                                                                                                                                          |
| ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A number in `[20, 100)` used as a table `x`/`y`/`w`/`h` now means inches, as it does everywhere else. | The backend's table path used a different inch/EMU threshold (20) from the rest of its API (100), so the same authored number meant different things depending on which component it was on. The compiler applies one rule. The affected range is meaningless under either reading (20–100 inches, or 20–100 EMU ≈ 0.0001"). |
| `underline: false` no longer underlines.                                                              | The pre-IR writer treated any boolean as "underline", so `false` turned it on.                                                                                                                                                                                                                                               |
| `bullet: { type: 'bullet' }` now produces a bullet.                                                   | The object form was passed through in a shape the backend ignored, so an authored bullet silently did nothing. The boolean form always worked.                                                                                                                                                                               |
| A rounded table positioned with percentages now gets its rounded backdrop.                            | The backdrop was drawn only when `x` and `y` happened to be plain numbers, so a percentage-positioned rounded table came out square. The IR always carries a resolved absolute origin.                                                                                                                                       |
| A `highcharts` component inside a template placeholder is now rejected rather than rendered.          | Placeholder content is merged with its declaration during compilation, so expanding the chart beforehand would size it from pre-merge dimensions. Failing is better than rendering it at the wrong size; slide- and template-level highcharts are unaffected.                                                                |

Image `sizing` and aspect-ratio auto-fill moved into a pre-pass rather than
being split between the writer and the backend, but the results are unchanged —
the corpus cases for `contain`, `cover` and the auto-fill were recorded from the
old implementation and still pass.

`transition` remains authored-but-ignored on the default backend: PptxGenJS has
no transition API, and the compiler does not lower it, so it is dropped exactly
as it always was. It is modelled in the IR and supported by `office-open`, and
becomes real for both when the compiler lowers it.

### How these were found

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

## Source map

| Concern         | Path                                |
| --------------- | ----------------------------------- |
| Shared contract | `packages/shared/src/rendering/`    |
| PptxIR          | `packages/core-pptx/src/ir/`        |
| PPTX renderers  | `packages/core-pptx/src/renderers/` |
| DocxIR          | `packages/core-docx/src/ir/`        |
| DOCX renderers  | `packages/core-docx/src/renderers/` |

Import discipline: only `renderers/pptxgenjs/` may import `pptxgenjs`; only
`renderers/docxjs/` may import `docx`; only `renderers/office-open/` may import
`@office-open/*`. Compiler and IR files import no renderer at all.
