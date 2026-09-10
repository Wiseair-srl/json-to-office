# @json-to-office/jto-ops

## 6.2.0

### Minor Changes

- 1a9b769: Complete the design checks: theme and profile consistency in PPTX, the content hierarchy and integrity inventory in both formats, and the last rendered detector (#332, #347, #344, #334).

  **PPTX is judged against its theme's sizes.** `pptx/type-scale`, `pptx/size-count` and `pptx/role-drift` are the twins of the DOCX rules, reading the resolved theme's named styles, its type roles projected onto them, the deck default and the canvas's type scale — so a custom theme is judged by its own values. `pptx/title-drift` has no theme value to read, because no theme states where a title goes: it compares each title with the deck's other titles of the same kind, block by block, so a statement slide that centres its assertion is not drift. All four are off until a profile turns them on; `consulting-deck` does.

  **Ten content and integrity rules close the bounded inventory.** DOCX: the measure body copy runs at, a section that renders nothing, a section carrying prose under no heading, a heading a page break can strand (with the `keepNext` patch that binds it), a figure with neither caption nor alt text, and a document with more headings than the profile allows without a contents page. PPTX: bullets past the profile's count or length, content outside the theme's safe area that is neither chrome nor a full bleed, and a content slide nothing names. Both formats gain `image-aspect`, which reads the asset where the document carries it — a data URI, or an inline SVG's viewBox — and says nothing when one side is left for the asset to supply or when PPTX `sizing` fits the image to its box.

  **`rendered/table-split`** names a table broken badly across a page: its header alone at a page foot, or one row alone on either side of the break, reported at the row's leftmost cell. The labelled mapping corpus gains the case and scores precision and recall of 1.000 over 51 entries.

  **Two reference documents were wrong and are fixed.** The report template's LETTER demo section ran 123 characters a line at half-inch margins; its margins are now three-quarters of an inch. The deck cover stretched any logo that was not 18:10; the frame now states a width and lets the height follow the asset, as the report cover already did.

  Every new rule names the value it expected and whether the theme, the profile or the asset asked for it, and appears in the generated design guide.

  **API.** `@json-to-office/quality` gains the shared implementations the two formats now call: `offScaleFindings`, `sizeCountFinding`, `roleDriftFindings`, `driftingSizes` and `SIZE_TOLERANCE_PT` for type consistency, and `imageAspectFinding` with `DEFAULT_IMAGE_ASPECT_TOLERANCE`. Nothing was removed; the format packs keep the same rule ids, codes and parameters, and `role` is the key on `context` and `evidence.values` in both.

### Patch Changes

- Updated dependencies [1a9b769]
  - @json-to-office/quality@6.2.0
  - @json-to-office/core-docx@6.2.0
  - @json-to-office/core-pptx@6.2.0

## 6.0.0

### Patch Changes

- f9b6c20: Theme chrome recipes and the motif now reach the page in both formats (#361), and the report cover is a masthead (#407).

  **Every recipe has a consumer, and the inventory says which.** `docs/reference/theme-schema.md` now carries a table of `chrome` recipe × format × the composition that paints it, with a reason beside each field a format does not draw. `runningHead`, `tracker`, `actionTitle`, `keyTakeaways`, `sourceLine`, `confidentialFooter`, `logoSlot` and `cover` are read by the report and deck blocks; `motif` marks the top edge of the cover in both formats, and `kind: "none"` resolves to no motif at all so a composition can ask for it and draw nothing. `fill` is the one field nothing paints — no shipped block has a filled surface behind text — and that is stated rather than left as a gap.

  **A composition names the type role it paints in.** A block paragraph carried `font.family` pinned to `fonts.body.family`, so a theme's `display` role went on saying `face: "heading"` while the cover title rendered in the body face, and `tracker`'s `case: "upper"` and tracking never reached the running head. Paragraphs now name the role and let the style carry face, case, tracking, weight and spacing; the visible effect on the bundled themes is a running head set in tracked capitals, a cover title in the heading face, and section numbers and memo labels in the eyebrow role's own case.

  **Recipes layer over roles through a `$theme` pointer chain.** `{ "$theme": ["/chrome/sourceLine/color", "/styles/source/color"], "default": "textMuted" }` reads "the recipe's colour, else the role's, else this" — so a theme that states no chrome renders exactly as before, and one that states some overrides only what it names. `$if`, `$each` and `$count` also accept a `{ "$theme": … }` operand, which is how an optional recipe field draws nothing on a theme that omits it.

  **A `themeStyle` naming a style the theme does not define no longer emits `w:pStyle`.** The paragraph used to reference a style that is not in `styles.xml`; Word ignores that, LibreOffice drops the paragraph's direct spacing along with it. The paragraph's own run and spacing props are the documented fallback.

  **The report cover is a masthead.** The theme's motif marks the top edge, the client sits under it in the eyebrow role, the cover rule and the title fall a third of the way down, and a `Prepared for / Date / Classification` band is pinned to the foot of the text area under a hairline — so a one-line and a three-line title leave the page equally balanced. A label whose value is missing is omitted with it. Chosen with Paolo from three rendered proposals across the four bundled DOCX themes at short, long and three-line titles.

  Breaking: the cover's `date`, `confidentiality` and `client` slots are bounded tighter (3, 4 and 6 words) so the metadata band cannot overflow the page — a document with longer values is now rejected at validation. `vermilion`'s `chrome.cover.color` and `chrome.actionTitle.color` become `accent`, matching the display and heading colours those recipes now paint. Every `blocks/*` corpus golden moved, with the reasons recorded in `docs/architecture/office-renderer-ir.md`.

- Updated dependencies [f9b6c20]
  - @json-to-office/core-docx@6.0.0
  - @json-to-office/core-pptx@6.0.0
  - @json-to-office/shared@6.0.0
  - @json-to-office/shared-docx@6.0.0
  - @json-to-office/shared-pptx@6.0.0

## 5.3.2

### Patch Changes

- 27e76b1: Three known defects of the report workflow, each verified on the rendered page rather than on the XML.

  **A section number now reads as part of its heading (#410).** The section gap sat on the heading, leaving the number above it in the space that separates two sections, so it read as a footnote to the section that had ended. Both report templates' `section-opener` definitions state the theme's `heading1` space-before on the number and none on the heading below it, keeping the number/heading pair together; an unnumbered opener keeps the heading style's own gap. No forced page breaks return — the sections still flow. Fixed examples measure the gap on the page across all four bundled DOCX themes, at a page top, mid-page and over a heading of more than one line, and a new drift guard pins the two templates' shared definitions to each other.

  **Rendered table cells no longer read as missing (#420).** Three false positives in the rendered pass, all from reading order. A row is now parted into cells at any gap the row's own word spacing cannot account for, not only at gaps wider than half a line: within a row a word space holds to its median within a hundredth, while a cell boundary poppler ran together at tight padding is close to twice it — so a wrapped cell's text stopped merging into its neighbour's. A run of rows that resolves into more than one column reads column by column even when no single row holds two cells, so a figure centred between the two lines of the label beside it no longer interrupts it. And a bare-digits row inside a page band counts as the page number only when it stands alone and its height recurs on another page, so a table's numeric row that flowed into the band keeps its own occurrence. Across the 24-document checkpoint set this clears nine false findings and adds none; genuinely missing and clipped cells still report. The issue named the second failure as the cell `1.05` losing its occurrence to the body text `£1.05m`; measured against the geometry that document actually rendered, `£1.05m` never claimed it — the numeric row had flowed into the bottom fifth of the page and was taken for the page number. The three documents that showed all this are now regression inputs.

  **A stub last page names the move that repairs it (#408).** The finding for a last page holding only the tail of the document now points at the section that closes the document — not at whatever section cited the source its notes were painted from — and its advice names the repair: `pageBreak: true` on that section, or on the one before it when the closing section already starts a page. That was chosen by measuring every page-break position in the last two sections of the four documents that showed the defect; a break on a section was the only move that cleared all four, and the recorded documents are now regression inputs. The finding's `mapping` still says whether the page's own words were owned, so the redirected pointer does not claim a match that was not made.

## 5.0.0

### Major Changes

- 3e7ad98: **Breaking (`@json-to-office/core-docx`, `@json-to-office/mcp-server`)**: the DOCX quality profile `technical-report` is now an archetype profile with requirements, and the format default is the new `general` profile. A document that names no profile is judged by `general` and reports `profileId: "general"` where it reported `technical-report`; a document that names `technical-report` now gets the archetype's findings: a running head with page numbers on every section after the cover, a source wherever a block declares one, heading skips as warnings, the three theme-consistency rules with at most nine sizes, rendered empty and under-filled pages as warnings, and at least one chart or table. Nothing blocks by default; the findings advise. Kept as one id rather than a second: a technical-report profile that asked nothing of a technical report was the format default under the wrong name.

  The `technical-report` blueprint (#338): a data-heavy report (summary, scope and method, results with a chart and two sub-headed findings and a runs table, recommendations, a readiness statement, references), a narrative one (summary, context, an analysis table, options and risks, a recommendation) and a memo (To, From, Date and Subject in place of a cover, the recommendation first, the options in one table, what would change the answer), all under a running head that numbers the pages and, in the reports, a contents list that LibreOffice renders from cached entries. Its definitions come from a new gallery template, `technical-report-blocks.docx.json`, a load-test report on the house theme that also defines `memo-header`; a test holds a definition shared by name across templates to one shape. `jto_scaffold` fills `memo-header` slots from the brief (`to`, `from`, `date`, and `title` as the subject), maps `###` headings to a section's level-2 heading markers, and writes outline paragraphs only into the body text between one opener and the next, so a memo's single section fills in order.

### Patch Changes

- Updated dependencies [3e7ad98]
  - @json-to-office/core-docx@5.0.0
  - @json-to-office/shared-docx@5.0.0

## 4.5.0

### Patch Changes

- e0b45f4: A new docx rule, `docx/exhibit-required` (`W_QUALITY_EXHIBIT_MISSING`, off by default), reports a document with fewer charts or tables of two or more columns than `minimumExhibits`; the `client-report` profile enables it at one, and the blueprint's narrative variant now scaffolds a data table in its analysis section so a fresh scaffold satisfies it. `rendered/page-underfilled` now also judges the last page, at a quarter instead of half, so a stub page holding only the notes and sources is reported (`context.kind` is `middle-page` or `last-page`).
- Updated dependencies [e0b45f4]
- Updated dependencies [0ce7b12]
  - @json-to-office/quality@4.5.0
  - @json-to-office/core-docx@4.5.0

## 4.4.4

### Patch Changes

- 8f23523: The rendered pass gains `rendered/page-underfilled` (`W_QUALITY_RENDERED_PAGE_UNDERFILLED`): a docx page, other than the first and the last, whose ink stops less than halfway down the body area before the next page begins, mapped to the section that owns the page with the measured share on `context.fill`. Ink, not words, so a chart or a table fills a page. The preview now samples each page in grayscale at 24 dpi with pdftoppm and caches the row profile beside the text geometry (preview cache version 2). The `client-report` profile reports the rule at `warning`.
- Updated dependencies [8f23523]
  - @json-to-office/quality@4.4.4
  - @json-to-office/core-docx@4.4.4

## 4.4.2

### Patch Changes

- fe55607: The rendered pass now reports a docx page whose only words are its running head or footer as an empty page (`W_QUALITY_RENDERED_EMPTY_PAGE` with `context.kind: "chrome-only"`; a wordless page carries `kind: "blank"`). Before, the repeated chrome counted as content and a stray trailing page under a running head passed clean. Decks keep the old behaviour: a slide with any word, its slide number included, is not empty. The `client-report` profile raises the rule to `warning`, since the report blocks put every figure in a captioned block.
- Updated dependencies [fe55607]
  - @json-to-office/core-docx@4.4.2

## 4.4.0

### Minor Changes

- efd7c6b: Block boundary matrix (#343, report portion): every JSON block the client-report template embeds, at the edges of its slot schema on every bundled DOCX theme, in design and fallback fonts, on A4 and Letter, held warning-clean by the static rules and by the rendered pass through LibreOffice. The matrix found and this release fixes a `columns` table rendering at half the measure after any paragraph (a nested `columns` no longer makes its section multi-column, and the table now carries its grid), and tightens the report block budgets the layout could not hold: running-head title 6 words and tracker 3, section-opener tracker 3, cover title 12 and subtitle 20 words with their own line spacing, KPI value 7 and unit 5 characters with the figures a size smaller at four, data-table columns 1–5 with headers of 14 and cells of 10 characters, rows that never split and the block's own cell padding. Scaffold markers are no longer measured against slot budgets or choices, by the one predicate `@json-to-office/quality` exports (`isScaffoldMarker`), and the playground editor schema agrees. design-evals gains `--set` and the committed `client-report-checkpoint` brief set for #360. The rendered pass now reads a page in geometric order — a table row cell by cell, a rotated axis title as poppler gave it — so a wrapped cell maps on every poppler version, not only the one that already emits cells whole.

### Patch Changes

- Updated dependencies [efd7c6b]
  - @json-to-office/core-docx@4.4.0

## 4.2.0

### Minor Changes

- 829e982: Rendered pass (#344) under the quality contract. The pass is now a rule pack (`RENDERED_QUALITY_RULES`) run through the quality engine, so profiles, suppressions, severity overrides and gates apply to rendered findings; `jto_preview` takes the same `quality` option as `jto_validate`, judges by the document's declared profile or the format default otherwise, and reports `rendered.suppressed`, `rendered.blocked` and `rendered.profileId`. The design guide lists the rendered rules. A rendered preview prepares the document once and both generates from and maps through that prepared model. The DOCX text inventory covers a contents field (optional entries where it renders, scoped and depth-limited as the field is) and a native chart's title and axis titles, so neither steals a heading's first occurrence. A labelled mapping corpus (duplicates, contents page, ligatures, chrome around a split paragraph, a declared font that cannot load, chart titles, a truncated frame) scores mapping precision and recall at 1.0 against the ≥0.95 / ≥0.90 targets.

### Patch Changes

- Updated dependencies [829e982]
  - @json-to-office/core-docx@4.2.0

## 4.1.0

### Minor Changes

- c507e21: Rendered-certainty pass (#344, report prototype). `jto_preview` gains `renderedFindings: true`: the PDF LibreOffice produced is read for word geometry (`pdftotext -bbox-layout`) and embedded fonts (`pdffonts`), and `jto-ops` turns them into quality findings with `certainty: "rendered"` — text cut off or truncated (`W_QUALITY_RENDERED_CLIP`), a framed paragraph or text box drawn past its declared box (`W_QUALITY_RENDERED_SPILL`), words drawn over each other (`W_QUALITY_RENDERED_OVERLAP`), authored text that never rendered (`W_QUALITY_RENDERED_TEXT_MISSING`), substituted families (`W_QUALITY_RENDERED_FONT_SUBSTITUTED`, information unless the document declared a source), empty pages, stranded headings and split paragraphs. Findings map to authored pointers through a new `docx/text` inventory fact (every painted string with its role, through the block source maps) and reading-order matching that handles duplicate strings, ligatures, page-broken paragraphs and partial clipping; each carries `context.mapping` and unmapped findings stay visible at the document root. Geometry is cached beside the page count. The design-evals scorecard counts rendered findings by mapping outcome and includes the rendered integrity codes in its defect rate.

### Patch Changes

- Updated dependencies [c507e21]
  - @json-to-office/core-docx@4.1.0
  - @json-to-office/quality@4.1.0

## 4.0.0

### Patch Changes

- Updated dependencies [e29475b]
- Updated dependencies [102ab50]
  - @json-to-office/quality@4.0.0
  - @json-to-office/shared-docx@4.0.0
  - @json-to-office/shared-pptx@4.0.0
  - @json-to-office/core-docx@4.0.0
  - @json-to-office/core-pptx@4.0.0
  - @json-to-office/shared@4.0.0

## 3.3.0

### Patch Changes

- 8866586: Blueprints: document archetypes as data. A blueprint names a recommended theme, the quality profile that judges the result, the playground template whose JSON blocks it invokes, and structural variants whose every slot holds a `{{…}}` scaffold marker carrying the guidance for filling it. The first is `client-report` for DOCX, with a `data-heavy` and a `narrative` variant; `instantiateDocxBlueprint` turns one into a schema- and semantic-valid document that carries the definitions it invokes and their dependencies, plus a fill map listing every marker with its pointer, kind, budget and guidance. `jto_discover` lists the bundled blueprints as summaries.

  Profiles, not themes, own required chrome. Two DOCX rules, off by default: `docx/required-chrome` reports a block slot with a role the profile requires — a takeaway, a source — left empty, at the slot; `docx/running-head` reports a section from `fromSection` on without the header, footer or page-number field the profile expects. The new `client-report` profile turns both on and promotes heading skips to warnings. Both formats gain an optional root `qualityProfile`: the shipped profile validation judges the document by when the caller names none, a caller's profile winning and an unknown name falling back to the default — so a scaffold is judged against its archetype's bar from the first `jto_validate`.

  Fixes: an authored invocation was recorded twice when its definition invoked another block, doubling its slot-budget facts; a `metadata.date` the Date parser rejects — a scaffold marker, "Q3 2026" — no longer fails generation and leaves the package timestamps to the generation date.

- Updated dependencies [8866586]
- Updated dependencies [6a61aee]
  - @json-to-office/shared@3.3.0
  - @json-to-office/shared-docx@3.3.0
  - @json-to-office/shared-pptx@3.3.0
  - @json-to-office/core-docx@3.3.0
  - @json-to-office/core-pptx@3.3.0

## 3.2.0

### Minor Changes

- 28f180d: The report's figures as JSON blocks in the `client-report-blocks` playground template: `chart-figure` (a `highcharts` chart — or a native `chart` on office-open — with a caption, an optional takeaway and a required source), `figure` (an image or visual with caption and source) and `footnotes` (a "Notes and sources" list of every distinct source the document's blocks cite; nothing when there is none). Figures and charts number together.

  Two engine capabilities carry them. `{SEQ:name}` in paragraph text is a Word `SEQ` field the compiler also counts, so `Figure {SEQ:figure}.` reads 1, 2, 3 in document order in Word, headless LibreOffice and the preview PDF alike; both renderers write it. A DOCX block context exposes `/sources`, the ordered, de-duplicated `source`-role slot values across the document, each mapped back to the slot it was written in. A chart a block places is annotated by that block's `takeaway`/`source` slots, so `W_QUALITY_CHART_ANNOTATION` no longer asks for a caption inside it; chart findings keep authored paths.

  Chart data leaves the process only on purpose. A Highcharts export server the address does not prove private (loopback, RFC 1918, link-local or unique-local literals, `localhost`, `.local`, `.internal`, `.home.arpa`) is refused at generation time until `services.highcharts.allowRemote` — `HIGHCHARTS_ALLOW_REMOTE=1` on the CLI, playground and MCP server — and once allowed every generation reports `W_HIGHCHARTS_REMOTE_EXPORT` with the URL, in both formats. The charts guide documents exactly what the export request carries.

  The jto-ops format adapters now honour `services` passed to `createGenerator`/`generateBuffer`, service by service over the environment; before, an explicit export server URL was silently dropped in favour of `HIGHCHARTS_SERVER_URL` or the default.

### Patch Changes

- Updated dependencies [28f180d]
  - @json-to-office/shared@3.2.0
  - @json-to-office/core-docx@3.2.0
  - @json-to-office/core-pptx@3.2.0

## 3.0.0

### Minor Changes

- 7143379: Replace PPTX slide templates with document-local JSON blocks on the shared contract. The root `templates` array, the slide `template`, `placeholders` and `layout` props, the `MISSING_TEMPLATE`, `UNKNOWN_PLACEHOLDER` and `PLACEHOLDER_NO_POSITION` warnings and the `masters`/`placeholders` renderer capabilities are removed without aliases. A deck defines blocks in `props.blocks` and invokes them with `name: "block"`; a block expands into a transparent `group` of positioned primitives with a source map.

  New engine operations: `group` frames (nested coordinates), `direction`/`gap`/`weights` distribution, `gridConfig`, bounded text `fit` (`maxLines`, `shrink`; `text_fit_overflow` at the authored slot), definition `slide` effects (background, notes, grid) and component-slot `props` merged beneath slot content. Slot `role`s feed the new `pptx/required-chrome`, `pptx/action-title` and `pptx/slot-budget` rules; the `consulting-deck` profile requires takeaway and source and bounds the title at two lines.

  The `consulting` PPTX theme twins the DOCX house theme. The three shipped playground decks are converted; the new `consulting-deck-blocks` template carries the `action-chart` definition and `jto://blocks` lists both formats. Starters adopt the house theme. Corpus template cases are replaced by block cases with new goldens.

### Patch Changes

- Updated dependencies [1812512]
- Updated dependencies [4807d5d]
- Updated dependencies [7143379]
  - @json-to-office/shared@3.0.0
  - @json-to-office/shared-docx@3.0.0
  - @json-to-office/core-docx@3.0.0
  - @json-to-office/shared-pptx@3.0.0
  - @json-to-office/core-pptx@3.0.0
  - @json-to-office/quality@3.0.0

## 2.4.0

### Patch Changes

- 102d8a2: Three theme-loading defects, all of the same kind: a theme that validates, renders, and quietly is not what the file said.

  **DOCX theme layers were deleted between validation and the renderer.** `ensureThemeDefaults` rebuilt the theme from a hand-written literal of the ten root keys it knew about, so everything else the schema allows was dropped — `fontRegistry` and `noProofWords` on every bundled theme and every `--theme-path` render. Nothing failed: the file validated, generation succeeded, and the styling was simply absent, with no error to search for. It now spreads what it was given and backfills defaults after, at the root and inside `fonts`. `theme-round-trip.test.ts` walks `ThemeConfigSchema` and fails the day a property is added and forgotten here, which is the only moment that is cheap to fix. No shipped theme declares either key, so nothing renders differently today — this stops the next layer from vanishing the same way.

  **The PPTX theme guard checked nothing.** `isValidThemeConfig` was `typeof data === 'object' && data !== null`: `{}` came back `true`, and the caller carried on with a `ThemeConfigJson` the compiler trusted and could not read. It is now `Value.Check` against the schema, the same contract the DOCX twin has always had.

  **A PPTX `--theme-path` file was parsed but never validated.** The DOCX branch calls `loadThemeFromFile`; the PPTX branch did bare `readFileSync` + `JSON.parse` and handed the result to a compiler that reads `theme.defaults.fontSize` unguarded — so a malformed theme surfaced as a TypeError in the IR instead of a diagnostic naming the field. It now goes through `validatePptxTheme` and refuses with the first three errors, keeping the document's own theme.

- Updated dependencies [ed3a991]
- Updated dependencies [22f6f3e]
- Updated dependencies [c22a911]
- Updated dependencies [4526e5a]
- Updated dependencies [102d8a2]
  - @json-to-office/quality@2.4.0
  - @json-to-office/core-docx@2.4.0
  - @json-to-office/core-pptx@2.4.0
  - @json-to-office/shared-pptx@2.4.0

## 2.3.0

### Minor Changes

- b73f62f: `/validate` knows the plugin components the rest of the server knows.

  The dev server's `POST /api/<format>/validate` validated against the standard components alone, so a document naming a registered plugin came back `Unknown component "weather"` — the same name the schema route had just offered for completion and the generator would have expanded happily. The route now hands the registered components to the plugin-aware validator, which defers those nodes from the standard walk and checks each one's props against the version it resolves to. With no plugins registered nothing changes: `weather` is still unknown, which is the honest answer from a server that cannot build it either.

  Doing that exposed a second defect, in `core-docx`'s plugin validator itself: its walk returned at the first node that was not a custom component instead of descending, so it only ever checked components at the top level. A plugin component inside a `section` — every real document — was never validated against its props schema, by this route or by the pre-generation gate; `city: 123` passed both and failed later inside the component's own render. It now descends whatever the node is, matching what `core-pptx` already did. Custom components carried in props rather than `children` (a header, a table cell) are still outside this pass.

  `FormatAdapter` gains an optional `validateDocumentWithPlugins(doc, plugins)`, async because the core that owns the plugin-aware validators is imported on demand. Callers with an empty registry keep using the sync `validateDocument`.

### Patch Changes

- Updated dependencies [b73f62f]
  - @json-to-office/core-docx@2.3.0

## 2.0.0

### Patch Changes

- Updated dependencies [2d1a10b]
  - @json-to-office/core-docx@2.0.0
  - @json-to-office/shared-docx@2.0.0

## 1.11.0

### Minor Changes

- 3bfa61f: Inline SVG no longer dominates the cost of rendering a DOCX, and the raster
  fallback it produces can be turned off.

  Every inline SVG ships twice: the vector, which Word 2016+ and LibreOffice
  draw, and a PNG in the `fallback` slot for readers older than that. The
  fallback was rasterized one image at a time, which cost about 250ms each and
  went unnoticed while a document held a couple of dozen SVGs. Splitting the
  stock templates' page decoration into a component per motif took several of
  them past two hundred, and generation went from six seconds to seventy-seven.

  Two changes, and the second is the one that matters:

  - Rasters are produced through resvg's `renderAsync` and in a bounded batch
    rather than a serial loop. `Resvg.render()` is synchronous native code, so
    awaiting it never yields — a batch started concurrently still ran one at a
    time on the main thread, which is why simply starting them together changed
    nothing. `renderAsync` hands each raster to libuv's threadpool instead, worth
    roughly 30% (`standard-annual-report` 76.5s → 54.6s). Concurrency is capped at
    eight so the peak stays within the hosted container's memory, each raster
    already being held to a megapixel.
  - `svgRasterFallback: false` — `--no-svg-fallback` on the CLI — skips the raster
    altogether. That is the difference between 76.5s and **2.1s**, and it halves
    the package (1.10 MB → 0.57 MB), because the bulk of an artwork-heavy DOCX is
    fallback PNGs nothing modern ever draws. Rendered output is byte-identical
    through LibreOffice with the flag on or off; the vector is what gets drawn
    either way. docx.js requires the slot to be filled, so the vector bytes go in
    it — the same thing already shipped when a raster could not be produced — and
    only readers old enough to need the raster lose the image. Default is
    unchanged, so no existing output moves.

  Both preview paths take the opt-out, because a preview's answer is a PDF or a
  PNG and LibreOffice draws the vector to make it: the playground's
  `/preview/libreoffice-from-json` and the MCP server's `jto_preview`. Measured
  against the running playground, the stock templates went from 47-62s per
  preview to 5-8s, byte-identical PDFs. Downloads keep the fallback, since those
  bytes go to a reader that may be older than Word 2016.

  Corpus goldens digest every byte and none moved, which is also the check that
  `renderAsync` produces the same PNG as `render()`.

### Patch Changes

- Updated dependencies [5757874]
- Updated dependencies [64b7905]
- Updated dependencies [dd0240c]
- Updated dependencies [3bfa61f]
- Updated dependencies [c6f97a0]
  - @json-to-office/core-docx@1.11.0

## 1.5.0

### Minor Changes

- 9870128: Design quality becomes a first-class pipeline (#216, #218).

  Adds autonomous `@json-to-office/quality`: facts/rules/profiles/policy,
  certainty and evidence, suppressions, budgets, rule isolation, rich diagnostics,
  and explicit gates.

  DOCX/PPTX cores own preparation, authored-path provenance, facts, built-in rule
  packs, and five initial document-class profiles. Official adapters reuse one
  opaque `PreparedDocument` for analysis and rendering. Core entry points and
  format adapters expose the evidence-rich `QualityAnalysis` contract directly.

  CLI, MCP, HTTP, cache hits, and playground generation preserve rich quality
  diagnostics. Advisory remains default; profile/policy can block validation or
  generation before rendering. The executable 15-case reference corpus pins
  poor/professional/excellent verdicts and authored digests; the reference stock
  templates stay warning-clean apart from findings recorded as known-true.

  Estimator thresholds are calibrated against rendered ground truth: a new
  harness (jto-ops `test:ground-truth`) renders mutated stock templates through
  LibreOffice and scores predictions against exact PDF word geometry
  (`extractPdfTextGeometry`, exported from jto-ops). Calibration admits only
  top-aligned, unrotated boxes whose bottom-edge spill is directly comparable.
  The pptx text-fit `characterWidthFactor` moves 0.45 → 0.46 (the measured
  zero-false-warning optimum), pptx text facts gain box geometry, alignment,
  rotation, and compiler-aligned `autoFit`, and one stock template's undersized
  content slot — a measured 25pt real overflow — is fixed. Deterministic
  diagnostics now carry ready-made RFC 6902 `fixes`: fully specified table column
  rescaling, heading level repair, minimum font floor, and a fitting `fontSize`
  for estimated overflows when a size allowed by the active profile/policy fits.

  Three further rules close the gaps a dogfooding pass over the shipped templates
  exposed. DOCX had two active rules, neither about whether text fits, so five
  render defects scored clean: `docx/svg-text-bounds` reports a `<text>` baseline
  past its viewBox, which is never painted and leaves the PDF text layer with it;
  `docx/text-fit` reports a word too wide for its floating frame and a frame whose
  wrapped block runs off the sheet. Its width model sums per-character advances
  rather than applying one factor, since the same face measures 0.694 em/char for
  caps against 0.435 for lowercase, and it speaks only past an 8% overrun — the
  model's measured error against rendered geometry.

  `pptx/text-contrast` adds the accessibility axis, comparing each run against the
  surface actually behind it: its own fill, else the topmost earlier-drawn shape
  covering it, else the slide. Text under an image or chart yields no finding
  rather than a guess. Gradients are sampled at the text box, using a radius
  measured off a rendered slide — the last stop lands at half the bounding-box
  diagonal from the focus corner.

  The four legacy playground decks are removed, so the shipped set is exactly the
  reference corpus. Five render defects and three typos in the remaining templates
  are repaired, and 76 runs are recoloured to the ink that reads best at their
  worst point.

  `jto-cli` no longer truncates `--format json`: `process.exit()` in the same tick
  as a large write discarded whatever was still queued when stdout was a pipe, so
  output stopped at one pipe buffer and became invalid JSON, while a file redirect
  hid the bug entirely. All commands that terminate deliberately now flush first.

### Patch Changes

- Updated dependencies [9870128]
  - @json-to-office/core-pptx@1.5.0
  - @json-to-office/core-docx@1.5.0
  - @json-to-office/quality@1.5.0
  - @json-to-office/shared@1.5.0
  - @json-to-office/shared-pptx@1.5.0
  - @json-to-office/shared-docx@1.5.0

## 1.4.0

### Minor Changes

- 5dc65ef: The `office-open` renderer is installed rather than advertised, and every surface
  that offers a renderer now says whether it can run.

  `@office-open/docx` and `@office-open/pptx` were optional peer dependencies, so on
  any install that did not opt in — `npx` above all, where there is no project to
  `pnpm add` into — the renderer was listed by `jto_info`, listed per component by
  `jto_discover`, validated against by `jto_validate`, and then failed every render.
  The `visual` component's `renderMode: "native"` went with it, since that mode is
  documented as requiring the backend. They are ordinary dependencies now: ESM-only,
  no native code, no install scripts, 7.4 MB.

  Availability is reported as well as fixed, because an `--omit=optional` install or
  a broken tree can still produce the same gap:

  - `RendererRegistry.statuses()` loads each registered renderer once, memoized, and
    reports `{ id, default, available, reason, installHint }`. Exposed as
    `docxRendererStatuses()` / `pptxRendererStatuses()` and as `rendererStatuses()`
    on the format adapters.
  - `jto_info` returns `formats[].renderers[]` beside the existing `rendererIds`,
    and warns with the install line for any renderer that cannot load.
  - `jto_discover` marks each renderer profile `available`.
  - `jto_validate` warns when the profile a document will actually build with has no
    backend, instead of returning a clean result that the next call contradicts.

  Two error-reporting fixes alongside it:

  - `jto_preview` classified a missing backend as a generic build failure and
    suggested "a build failure is a defect in the JSON, not in the renderer" —
    sending the caller to validate a document that was never at fault. It now
    returns `E_DEPENDENCY_MISSING`, as `jto_generate` already did, and skips the
    validation pass that only added noise.
  - An internal failure no longer puts `error.stack` — absolute filesystem paths and
    module layout — into the tool result, where it reached whatever transcript the
    client keeps. Set `JTO_MCP_DEBUG_STACKS=1` to restore it.

### Patch Changes

- Updated dependencies [47bd0af]
- Updated dependencies [5dc65ef]
- Updated dependencies [f6476d3]
- Updated dependencies [47bd0af]
  - @json-to-office/core-docx@1.4.0
  - @json-to-office/shared-docx@1.4.0
  - @json-to-office/core-pptx@1.4.0
  - @json-to-office/shared@1.4.0

## 1.2.0

### Minor Changes

- ad35065: Extract the host operations layer into `@json-to-office/jto-ops`: format adapters, the LibreOffice pptx rasterizer and the platform font stagers now live in a package with no terminal dependencies, so hosts without a UI can use them without pulling in ink, react, commander or chalk. `@json-to-office/jto-cli` re-exports every moved symbol at the same name, so its API is unchanged.

### Patch Changes

- Updated dependencies [ad35065]
- Updated dependencies [ad35065]
  - @json-to-office/core-pptx@1.2.0
  - @json-to-office/shared-pptx@1.2.0
  - @json-to-office/shared-docx@1.2.0
  - @json-to-office/shared@1.2.0
