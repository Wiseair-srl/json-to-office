# Design quality

A schema-valid document can still be hard to read: text may overflow, a slide
may contain too much prose, or a table may be wider than the page. The design
quality layer checks those problems after structural [validation](/guide/validation)
has succeeded.

Quality findings are advisory by default. Each finding explains the problem,
points to the authored JSON path and records how certain the check is. A policy
can promote, suppress or use findings to block CI and generation.

Every surface runs the same analysis. This guide uses the CLI because it is the
shortest thing to show, but the [playground](/guide/playground#design-quality)
is the fastest way to see findings on a document you are writing: it analyses as
you type, and applies the suggested fixes with a click.

## Start with the CLI

Run the default rules without blocking:

```bash
jto pptx validate deck.json
jto docx validate report.json
```

Make warnings and errors fail the command:

```bash
jto pptx validate deck.json --quality-gate warning
```

Use a shipped profile by putting its ID in a JSON file:

```json
{
  "id": "executive-presentation",
  "formats": ["pptx"]
}
```

```bash
jto pptx validate deck.json --quality-profile executive-presentation.json
```

The same options work with `generate`. Generation stops before rendering when
the selected quality gate is not satisfied.

## How analysis works

The format core first resolves the authored document into a prepared model. It
applies the information the renderer will use — themes, defaults, blocks,
groups, grids, disabled state and section geometry — while preserving RFC
6901 pointers back to the source JSON, through block expansion. Rules then inspect facts from that model.

This makes checks such as effective font size and available table width more
useful than scanning raw props. It also lets generation and quality analysis
reuse the same prepared document.

Quality is additive to validation:

- malformed or structurally invalid input belongs to validation;
- valid input is evaluated against every enabled quality rule;
- a rule failure is reported separately from a design finding;
- generation warnings are a third channel for recoverable renderer problems.

See the [PPTX warning reference](/reference/pptx/warnings) for that last channel.

## Read the result

The core analyzers return `QualityAnalysis`:

```ts
{
  diagnostics: QualityDiagnostic[];
  counts: { error: number; warning: number; info: number };
  blocked: boolean;
  truncated: boolean;
  suppressedCount: number;
  evaluatedRuleIds: string[];
  ruleErrors: { ruleId: string; message: string }[];
  profileId?: string;
}
```

A diagnostic contains:

```ts
{
  source: 'quality';
  ruleId: string;
  code: string;
  severity: 'error' | 'warning' | 'info';
  category: string;
  certainty: 'deterministic' | 'measured' | 'estimated' | 'rendered' | 'evaluative';
  blocking: boolean;
  message: string;
  path: string;
  suggestion?: string;
  relatedPaths?: string[];
  evidence?: { actual?: unknown; expected?: unknown; unit?: string };
  fixes?: JsonPatchOperation[];
}
```

`severity` says how much the finding matters. `certainty` says how the conclusion
was reached. Promoting an estimated finding to `error` does not make it
deterministic; consumers can show or gate the two dimensions independently.

`blocked` is the policy verdict. Do not derive it from `counts`: a profile or
policy can change severity without enabling a gate.

Counts cover all unsuppressed findings before the output budget is applied, so
they can be larger than the returned `diagnostics` array when `truncated` is
true.

## Built-in PPTX rules

| Rule                     | Codes                                                                                                                                                                       | Default                                                 | Certainty     | What it checks                                                                             |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | ------------- | ------------------------------------------------------------------------------------------ |
| `pptx/canvas`            | `W_QUALITY_CANVAS_UNSPECIFIED`, `W_QUALITY_CANVAS_NONSTANDARD`, `W_QUALITY_CANVAS_LEGACY`                                                                                   | warning when missing; otherwise info                    | deterministic | Missing, legacy 4:3 or nonstandard canvas dimensions                                       |
| `pptx/minimum-font-size` | `W_QUALITY_FONT_SIZE_MIN`                                                                                                                                                   | warning                                                 | measured      | Effective text size below `minimumFontPt` (7pt by default)                                 |
| `pptx/text-fit`          | `W_QUALITY_TEXT_OVERFLOW`, `W_QUALITY_TEXT_TIGHT`                                                                                                                           | warning for overflow; otherwise info                    | estimated     | Estimated text height exceeds, or nearly fills, its box                                    |
| `pptx/slide-density`     | `W_QUALITY_SLIDE_DENSITY`                                                                                                                                                   | warning                                                 | estimated     | Body text exceeds `maximumBodyWords` (130 by default)                                      |
| `pptx/text-contrast`     | `W_QUALITY_TEXT_CONTRAST`                                                                                                                                                   | warning                                                 | deterministic | Text falls below WCAG AA against the surface behind it                                     |
| `pptx/placeholder-text`  | `W_QUALITY_SCAFFOLD_MARKER`, `W_QUALITY_PLACEHOLDER_TEXT`                                                                                                                   | warning                                                 | deterministic | An unfilled scaffold slot, or leftover filler text                                         |
| `pptx/box-overlap`       | `W_QUALITY_BOX_OVERLAP`                                                                                                                                                     | warning for a duplicate or covered data; otherwise info | deterministic | Two opaque boxes on one slide that land on each other                                      |
| `pptx/chart-design`      | `W_QUALITY_CHART_3D`, `W_QUALITY_CHART_OVERLOADED`, `W_QUALITY_CHART_AXIS_BASELINE`, `W_QUALITY_CHART_SERIES_COLORS`, `W_QUALITY_CHART_UNITS`, `W_QUALITY_CHART_ANNOTATION` | warning, except units and caption, which are info       | deterministic | What a chart claims about its numbers                                                      |
| `pptx/table-design`      | `W_QUALITY_TABLE_NUMERIC_ALIGN`, `W_QUALITY_TABLE_MIXED_DECIMALS`, `W_QUALITY_TABLE_GRID`, `W_QUALITY_TABLE_ROW_COUNT`                                                      | warning, except the grid, which is info                 | deterministic | How a table lays its numbers out, and how long it runs                                     |
| `pptx/font-count`        | `W_QUALITY_FONT_COUNT`                                                                                                                                                      | warning                                                 | deterministic | More than `maximumFamilies` (3) font families in one document                              |
| `pptx/palette-adherence` | `W_QUALITY_OFF_PALETTE`                                                                                                                                                     | info                                                    | deterministic | A literal colour the resolved theme does not define                                        |
| `pptx/off-canvas`        | `W_QUALITY_OFF_CANVAS`                                                                                                                                                      | warning                                                 | measured      | Text ink, placed by its alignment, more than `tolerancePt` (2) past a slide edge           |
| `pptx/slot-budget`       | `W_QUALITY_SLOT_BUDGET`                                                                                                                                                     | warning                                                 | deterministic | A block slot over the word budget its definition declares                                  |
| `pptx/required-chrome`   | `W_QUALITY_CHROME_MISSING`                                                                                                                                                  | warning; off unless a profile names `required` roles    | deterministic | A block slot with a role the profile requires left empty                                   |
| `pptx/action-title`      | `W_QUALITY_ACTION_TITLE_LENGTH`                                                                                                                                             | warning; off unless a profile sets `maxLines`           | estimated     | An action-title slot wrapping past the lines the profile allows                            |
| `pptx/type-scale`        | `W_QUALITY_TYPE_OFF_SCALE`                                                                                                                                                  | warning; off unless a profile enables it                | deterministic | An authored size the theme never paints; the fix snaps it to the nearest size on its scale |
| `pptx/size-count`        | `W_QUALITY_TYPE_SIZE_COUNT`                                                                                                                                                 | warning; off unless a profile enables it                | deterministic | More distinct text sizes in the deck than `maximumSizes` (8), blocks included; no fix      |
| `pptx/role-drift`        | `W_QUALITY_TYPE_ROLE_DRIFT`                                                                                                                                                 | warning; off unless a profile enables it                | deterministic | A named style or type role painted at two sizes; the fix restores the theme's size         |
| `pptx/title-drift`       | `W_QUALITY_TITLE_DRIFT`                                                                                                                                                     | warning; off unless a profile enables it                | deterministic | A title away from the left edge or baseline the deck's other titles of that kind share     |
| `pptx/bullet-density`    | `W_QUALITY_BULLET_COUNT`, `W_QUALITY_BULLET_LENGTH`                                                                                                                         | warning; off unless a profile sets a bound              | deterministic | More bullets in one box, or more words in one bullet, than the profile allows              |
| `pptx/safe-area`         | `W_QUALITY_SAFE_AREA`                                                                                                                                                       | warning; off unless a profile enables it                | measured      | Content outside the theme's safe area that is neither chrome nor a full bleed              |
| `pptx/slide-title`       | `W_QUALITY_SLIDE_UNTITLED`                                                                                                                                                  | warning; off unless a profile enables it                | deterministic | A slide carrying content with no action title and no title-styled box                      |
| `pptx/image-aspect`      | `W_QUALITY_IMAGE_ASPECT`                                                                                                                                                    | warning                                                 | deterministic | An image drawn at an aspect the asset does not have                                        |

The three type rules read the resolved PPTX theme exactly as their DOCX twins
read theirs: `styles` after the design system has projected every type role
onto it, the deck's default size, and each step of the theme's type scale for
the canvas in play. A custom theme is therefore judged by its own sizes.
`pptx/title-drift` has no theme value to read — no theme states where a title
goes — so it compares each title with the deck's other titles _of the same
kind_: titles placed by one block, or hand-placed boxes sharing one of the
`titleStyles`. A statement slide that centres its assertion is a different
kind and is not drift.

The canvas rule recognizes these deliberate presets: 16:9 standard
(`13.333 × 7.5`), 16:9 small (`10 × 5.625`), square (`7.5 × 7.5`), 4:5
vertical (`7.5 × 9.375`) and 9:16 story (`4.5 × 8`). If no size is declared,
the renderer uses a 10 × 7.5 inch 4:3 canvas, so the missing-canvas finding is a
warning rather than informational.

Contrast compares the resolved run colour against whatever actually sits
behind the text: its own shape fill, else the topmost earlier-drawn shape
covering it, else the slide background. Gradients are sampled at the text box
rather than reduced to their harshest stop, and a background the analyzer
cannot see through — an image, a chart — produces no finding instead of a
guess. Thresholds follow WCAG 2.1 AA: `normalRatio: 4.5`, dropping to
`largeRatio: 3` at `largeTextPt: 18`.

Text fit uses `characterWidthFactor: 0.46` and `safetyBufferPt: 8` by default.
It is an estimate, not a rendered measurement: it considers box dimensions,
effective font size, line spacing and paragraph spacing. A spill greater than
one line height is `W_QUALITY_TEXT_OVERFLOW`; a smaller spill or a margin below
the safety buffer is `W_QUALITY_TEXT_TIGHT`.

### PPTX limits

- Disabled components do not contribute facts.
- Minimum-font and density checks can inspect positioned or unpositioned plain
  text. Text-fit additionally needs a resolved width and height.
- Text authored with `runs` is currently excluded from text facts. The analyzer
  does not guess at mixed run styles.
- Density counts body words, not titles or all visible characters.
- Contrast covers colours the document states. Text over an image or a chart
  is skipped, and a box laid across a gradient is judged at its worst sampled
  point — which can be a shortfall no single ink colour resolves.
- The analyzer does not render slides. It cannot judge overlaps, image quality,
  alignment, factual correctness or narrative quality.

These omissions are deliberate. Missing evidence produces no finding rather
than a confident-sounding guess.

## Box overlap

Only _opaque_ boxes take part: an image, a chart, a table, or a rectangle with
an opaque fill. Those paint their whole rectangle, so two of them intersecting
really do hide each other, which is a claim that needs no renderer. A text box
supports no such claim — authors routinely declare one far larger than the
words inside it, and reference-quality decks are full of designs where two text
rectangles cross and no ink does: an 80pt title beside a 12pt label, a value
centred in the hole of a donut chart. Word-level overlap is the rendered pass's
job.

Transparency disqualifies a fill, and only `rect` and `roundRect` count: an
ellipse, a pie wedge or a chevron leaves most of its bounding box empty, and
decks stack tinted discs and radial segments whose boxes cross by design.

Intersecting is not the same as wrong, so the verdict is split. Two opaque
boxes crossing is `info` — an accent strip along the top of a card, a badge in
the corner of a photograph. Two cases are warnings, because neither is ever a
design: a box whose geometry matches another to within two points is a leftover
duplicate, and anything covering a chart or a table covers data. A box fully
inside a larger one is layering, and is not reported; two equal rectangles are
the duplicate case, and are.

## Font families and palette

`font-count` counts the distinct families a document can paint: the theme's
`heading` and `body` roles plus every family named in the document. A theme's
`mono` and `light` roles are not counted — they paint nothing until a component
asks for them, and counting an unused `Courier New` would flag a report that
uses one typeface. Past three families a document reads as assembled rather
than designed, which is a warning; the limit is the `maximumFamilies`
parameter.

`palette-adherence` reports a colour written as a literal that the resolved
theme — named theme plus any in-document overrides — does not define, and
offers the nearest token as an RFC 6902 fix. Nearest is by the "redmean"
approximation, which ranks near-neighbours much the way an eye does; ties break
on token name so the same document always emits the same fix. It is `info`
because an off-palette colour is often deliberate, a client's own brand red in
an otherwise on-theme report; the finding makes the choice visible rather than
overruling it. A colour is recognised by where it sits — a property whose name
mentions colour, fill, stroke, background or border — so a hex inside a
sentence stays prose.

## Placeholder text and scaffold markers

Both formats run the same check over every authored string, and answer with
two different codes because the two states have different consequences.

`W_QUALITY_SCAFFOLD_MARKER` is a deliberate draft state: a slot still holding
the <code v-pre>{{…}}</code> marker a scaffold wrote into it. `jto_validate` reports the markers
and still answers `ok: true` — a draft is a legitimate thing to hold — but
`jto_generate` refuses the document with an `E_SCAFFOLD_MARKER` error per
remaining slot, because a generated file is what someone sends on.

`W_QUALITY_PLACEHOLDER_TEXT` is leftover filler: lorem ipsum, "Your title
here", "Click to add title", a whole-string `[bracketed placeholder]`, or bare
authoring debris (`TODO`, `XXX`). Nobody put it there on purpose and nobody but
the author can be certain it is not the real copy, so it only ever advises and
never blocks. Deliberate values authors do write — `TBD`, `N/A`, a citation
like `[1]` — are not placeholders and are never flagged.

The scan visits every string in the document, not a list of text-bearing
properties: an allowlist drifts as components gain properties, and a marker it
misses is a marker generation lets through. Components with `enabled: false`
are skipped — they never reach the page. Neither code carries a fix; only the
author knows what the sentence was meant to say.

The gallery templates are demonstration documents whose copy is lorem ipsum,
so they carry this finding by design; the calibration suite records the count
per template rather than suppressing the rule.

Every built-in rule carries a one-sentence `description` — the field is
optional on the `QualityRule` contract, so a rule pack of your own may omit it
and the guide prints nothing in its place. The MCP server renders the whole
pack — with each rule's code, category, default severity, certainty,
parameters and whether a profile has to switch it on — into
`jto://guide/design/<format>` beside the themes, profiles, blocks and
blueprints, so the guidance an agent reads is generated from the data the
rules run on.

## Built-in DOCX rules

| Rule                     | Code                                                                                                                                                                        | Default                                                    | Certainty     | What it checks                                                                                             |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ------------- | ---------------------------------------------------------------------------------------------------------- |
| `docx/table-width`       | `W_QUALITY_TABLE_WIDTH_OVERFLOW`                                                                                                                                            | warning                                                    | deterministic | Explicit column widths exceed the usable width of their section, with a 10-twip rounding tolerance         |
| `docx/heading-hierarchy` | `W_QUALITY_HEADING_SKIP`                                                                                                                                                    | info                                                       | deterministic | A heading jumps down by more than one level                                                                |
| `docx/text-fit`          | `W_QUALITY_TEXT_OVERFLOW`                                                                                                                                                   | warning                                                    | estimated     | A word too wide for its floating frame, or a frame whose wrapped block runs off the sheet                  |
| `docx/frame-collision`   | `W_QUALITY_FRAME_COLLISION`                                                                                                                                                 | warning                                                    | estimated     | Two page-anchored floating frames whose estimated text blocks land on the same region of a page            |
| `docx/svg-text-bounds`   | `W_QUALITY_SVG_TEXT_CLIPPED`                                                                                                                                                | warning                                                    | deterministic | A `<text>` baseline in an inline SVG falls outside the viewBox, so the words are never painted             |
| `docx/line-box`          | `W_QUALITY_LINE_BOX_COLLAPSE`                                                                                                                                               | warning                                                    | measured      | An `exactly` line box on text is shorter than the capitals it holds                                        |
| `docx/placeholder-text`  | `W_QUALITY_SCAFFOLD_MARKER`, `W_QUALITY_PLACEHOLDER_TEXT`                                                                                                                   | warning                                                    | deterministic | An unfilled scaffold slot, or leftover filler text                                                         |
| `docx/slot-budget`       | `W_QUALITY_SLOT_BUDGET`                                                                                                                                                     | warning                                                    | deterministic | A block slot holding more words than the block allows it, reported at the authored slot                    |
| `docx/chart-design`      | `W_QUALITY_CHART_3D`, `W_QUALITY_CHART_OVERLOADED`, `W_QUALITY_CHART_AXIS_BASELINE`, `W_QUALITY_CHART_SERIES_COLORS`, `W_QUALITY_CHART_UNITS`, `W_QUALITY_CHART_ANNOTATION` | warning, except units and caption, which are info          | deterministic | What a chart claims about its numbers                                                                      |
| `docx/table-design`      | `W_QUALITY_TABLE_NUMERIC_ALIGN`, `W_QUALITY_TABLE_MIXED_DECIMALS`, `W_QUALITY_TABLE_GRID`, `W_QUALITY_TABLE_ROW_COUNT`                                                      | warning, except the grid and the row count, which are info | deterministic | How a table lays its numbers out, and how long it runs                                                     |
| `docx/required-chrome`   | `W_QUALITY_CHROME_MISSING`                                                                                                                                                  | warning; off unless a profile names `required` roles       | deterministic | A block slot with a role the profile requires — a takeaway, a source — left empty                          |
| `docx/running-head`      | `W_QUALITY_CHROME_MISSING`                                                                                                                                                  | warning; off unless a profile names `required` parts       | deterministic | A section from `fromSection` on without the header, footer or page-number field the profile expects        |
| `docx/exhibit-required`  | `W_QUALITY_EXHIBIT_MISSING`                                                                                                                                                 | warning; off unless a profile enables it                   | deterministic | Fewer charts or tables of two or more columns than `minimumExhibits` (1); a kpi-row does not count; no fix |
| `docx/type-scale`        | `W_QUALITY_TYPE_OFF_SCALE`                                                                                                                                                  | warning; off unless a profile enables it                   | deterministic | An authored size the theme never paints; the fix snaps it to the nearest size on the theme's scale         |
| `docx/size-count`        | `W_QUALITY_TYPE_SIZE_COUNT`                                                                                                                                                 | warning; off unless a profile enables it                   | deterministic | More distinct text sizes in the document than `maximumSizes` (8), blocks included; no fix                  |
| `docx/role-drift`        | `W_QUALITY_TYPE_ROLE_DRIFT`                                                                                                                                                 | warning; off unless a profile enables it                   | deterministic | A heading level or paragraph style painted at two sizes; the fix restores the theme's size                 |
| `docx/body-measure`      | `W_QUALITY_BODY_MEASURE`                                                                                                                                                    | warning; off unless a profile enables it                   | estimated     | A section whose body copy runs outside 45–90 characters a line; the report profiles judge at 120           |
| `docx/section-content`   | `W_QUALITY_SECTION_EMPTY`, `W_QUALITY_SECTION_UNTITLED`                                                                                                                     | warning; off unless a profile enables it                   | deterministic | A section that renders nothing, or one carrying 60+ words under no heading                                 |
| `docx/heading-keep-next` | `W_QUALITY_HEADING_ORPHAN`                                                                                                                                                  | warning; off unless a profile enables it                   | deterministic | A heading a page break can strand; the fix adds `keepNext`                                                 |
| `docx/figure-label`      | `W_QUALITY_FIGURE_UNLABELLED`                                                                                                                                               | warning; off unless a profile enables it                   | deterministic | An image with neither a caption beside it nor alt text on it                                               |
| `docx/image-aspect`      | `W_QUALITY_IMAGE_ASPECT`                                                                                                                                                    | warning                                                    | deterministic | An image drawn at an aspect the asset does not have                                                        |
| `docx/contents-missing`  | `W_QUALITY_CONTENTS_MISSING`                                                                                                                                                | info; off unless a profile sets `minimumHeadings`          | deterministic | More headings than the profile allows without a table of contents                                          |

The three consistency rules divide their evidence the way the whole system
does: the theme supplies the values and the profile supplies the requirement.
The measure is estimated: an average advance over ordinary English at the
section's body size, across the section's usable width. A section that lays
any of its text in a `columns` component has no measure fact — the column, not
the page, is the measure there, and answering with the page's number would be
worse than saying nothing. The image-aspect rules read the asset only where
the document carries it: a base64 data URI, or an inline SVG's viewBox. A
`path` is resolved against a base directory at generation time, so a distorted
file-backed image is the rendered pass's to catch. Neither rule speaks when one
side is left for the asset to supply, or when PPTX `sizing` fits the image to
its box.

`docx/type-scale` reads every size the resolved theme paints — its named
styles, its font roles, every step of its declared type scale — so a custom
theme is judged by its own list and a block's compiled paragraphs, whose sizes
bind to those styles, are never reported. `docx/size-count` counts what
reaches the page, blocks included, against a ceiling of eight that a profile
or a policy can move through `maximumSizes`; it counts per document, because
static analysis has no page model for flowed text, and it offers no fix,
because which size to drop is a judgement.
`docx/type-scale` yields to `docx/role-drift` on any pointer the latter
reports, so one size never receives two different fixes, and it reports one
finding per role and size whose patch snaps every place together, so a repair
never leaves the role at two sizes.
`docx/role-drift` groups text by the style it inherits — `heading2`, `normal`,
a `themeStyle` — and reports an authored size that departs from the theme's
size for that role while the role is painted at more than one size; a role
overridden the same way everywhere is a choice, not drift.

All three read every surface that paints text, not only body paragraphs:
headings and paragraphs, table cells and header cells — including a component
nested in a cell, which lives outside the component tree the walk reaches — as
the `tableCell` and `tableHeader` roles, counted against the size every
untouched cell inherits,
and the paragraphs of a section's running head and footer (as the `header` and
`footer` roles, which the theme gives no size of their own, so they are checked
against the scale and never for drift). Each finding points at the pointer that
wrote the size — `…/props/font/size` on a node, `…/props/columns/0/cells/2/font/size`
on a cell — and a size a block compiled from its own definition is never
reported, because the author has nothing there to patch. Each finding's
`evidence.values.source` names `theme` or `profile`. All three are off on the
default profile: an editorial layout sets display sizes by hand, and only an
archetype decides that a document must keep to the scale.

Frame text fit only inspects paragraphs pinned into a floating frame, where
the author rather than the layout engine decides the available room; flowed
body copy repaginates and needs no check. Its width model sums per-character
advances — a single characters-per-point factor cannot serve both caps and
lowercase, which measured 0.694 and 0.435 em per character on the same face —
and it reports only past an 8% tolerance, the measured error of that model. An
overrun smaller than one line height is likewise ignored. Marginal cases are
therefore out of reach by construction, and belong to a rendered-certainty
pass rather than a static estimate.

Frame collision compares those same pinned frames against each other: each
frame becomes a rect from its authored offsets and width plus its estimated
wrapped-text height, and two rects on the same page that share more than a
sliver of width and more than one line of height are reported as painting over
each other. Consecutive paragraphs with identical frame properties are one
flowing OOXML frame — the stock stat cards stack a number, caption and body
this way — so a chain is measured as a single frame, never as members
colliding with themselves. The one-line floor exists because the height
estimate inherits the width model's error, and because tight editorial
layouts deliberately tuck captions into the slack of a display digit's line
box; an overlap has to cost real text before it is worth a warning.

SVG text bounds needs no estimate: the baseline and the viewBox are both
authored numbers, and text below the canvas is dropped from the PDF text layer
as well as the page, so it escapes search, copy and screen readers.

The line-box rule guards the other half of the legibility floor. `font.size`
stops at 8pt because smaller type cannot be read; the box the glyphs sit in has
no floor of its own, so `{ "type": "exactly", "value": 1 }` on 8pt text is a
schema-valid 1pt line. It fires only on `exactly`, which pins an absolute
height — `atLeast` and the multiples can only ever be as tall as the text needs
— and only on a paragraph or heading that has text: an empty paragraph with a
collapsed box is how a thin spacer is drawn, and the stock templates draw them
that way.

The floor is relative, at 0.7 em: cap height on the faces the stock templates
use, and below every legitimate value in the reference corpus, whose tightest
exact box is 10pt on 12pt type. Tight display leading is a real technique and
stays silent. The repair grows the box to one em rather than to the floor,
because a box at the floor still collides with the line below it: rendered at
8pt, stacked lines touch at 0.7 and 0.8 em, clear at 0.9 and are clean at 1.0.
The size compared against is the one Word will lay out — authored, from
`componentDefaults`, or inherited from the paragraph style, which either states
a size or names the theme font that carries one.

The finding also names the way out. A collapsed line box is usually not a
leading mistake but someone drawing a line, because until the
[`divider`](/reference/docx/components#divider) component there was nothing
else to draw one with: `font.size` floors at 8pt, so an author after a 3pt line
collapsed the box instead. `divider` owns that construction — the same empty
paragraph, the same border, the same collapsed box — on a paragraph with no
glyphs to clip.

Table cells are out of scope: a cell's row can grow past its line box, so the
same geometry there is not the same defect.

Table analysis accounts for the actual section width and margins. It reports a
repair patch only when every column width is explicit, because proportional
scaling is then deterministic. Heading analysis reports the source path of the
level and can patch it to the next valid level.

DOCX quality coverage is intentionally narrow today. It does not evaluate prose,
typography, whitespace, widow/orphan behavior, color or the visual result
produced by Word.

## The rendered pass

Every rule above reads the document; one pass reads the page. `jto_preview` with `renderedFindings: true` converts through LibreOffice as it does for pixels, then reads the PDF's word geometry (`pdftotext -bbox-layout`) and embedded fonts (`pdffonts`) and reports what only ink can show, with `certainty: "rendered"`:

| Rule                        | Code                                  | Severity       | What it reports                                                                                                                                                                                                 |
| --------------------------- | ------------------------------------- | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rendered/clip`             | `W_QUALITY_RENDERED_CLIP`             | warning        | Words past the page edge by more than 2 pt, or a paragraph of which only a leading part rendered (`kind: truncated`, with the share found)                                                                      |
| `rendered/spill`            | `W_QUALITY_RENDERED_SPILL`            | warning        | A framed paragraph or slide text box drawn taller or wider than the box it declared                                                                                                                             |
| `rendered/overlap`          | `W_QUALITY_RENDERED_OVERLAP`          | warning        | Two words from different lines whose boxes intersect by more than 30% of the smaller                                                                                                                            |
| `rendered/text-missing`     | `W_QUALITY_RENDERED_TEXT_MISSING`     | warning        | An authored string that appears nowhere in the PDF: fully clipped, hidden, or dropped by the renderer                                                                                                           |
| `rendered/font-substituted` | `W_QUALITY_RENDERED_FONT_SUBSTITUTED` | info / warning | A requested family the PDF embeds no face of; a warning when the document declared a source for it, information when the host simply lacks it                                                                   |
| `rendered/empty-page`       | `W_QUALITY_RENDERED_EMPTY_PAGE`       | info           | A wordless page (`kind: blank`), or in docx one whose only words are its running head or footer (`kind: chrome-only`)                                                                                           |
| `rendered/heading-stranded` | `W_QUALITY_RENDERED_HEADING_STRANDED` | warning        | DOCX: a heading that is the last body line on its page                                                                                                                                                          |
| `rendered/paragraph-split`  | `W_QUALITY_RENDERED_PARAGRAPH_SPLIT`  | info           | DOCX: a paragraph leaving one line alone on either side of a page break (`kind: orphan` or `widow`)                                                                                                             |
| `rendered/table-split`      | `W_QUALITY_RENDERED_TABLE_SPLIT`      | info           | DOCX: a table broken across a page badly — its header alone at a page foot (`kind: header-alone`), or one row alone on either side of the break (`kind: orphan-row` or `widow-row`)                             |
| `rendered/page-underfilled` | `W_QUALITY_RENDERED_PAGE_UNDERFILLED` | info           | A docx page whose ink stops well above the footer: a middle page under half filled (`kind: middle-page`) or a last page under a quarter filled (`kind: last-page`); `context.fill` is the share; needs pdftoppm |

Findings map back to authored pointers through the document's text inventory: every painted string with its role, in reading order, read off the prepared document so a string a block compiled reports at the slot the author wrote. Matching folds both sides to lowercase alphanumerics (ligatures split, punctuation and bullets drop out) and searches one stream over the whole document, so a paragraph that breaks across a page is still one match; running heads and footers are matched first and their rows removed, so a page number never interleaves the two halves. Duplicate strings are attributed in reading order — "Total" in the second table finds the second "Total" — and an entry whose every occurrence was already claimed is `ambiguous` rather than guessed. When the whole string is absent, its longest rendered prefix (at least 16 folded characters) maps it and reports the truncation.

A `last-page` finding whose page mapped at all points at the section that closes the document rather than at the section its text was authored in — the notes are painted from source slots the sections that cited them own, so the text furthest down a stub page names a section near the front — and its advice names the move that repairs it: `pageBreak: true` on that section, or on the one before it when the closing section already starts a page. That was chosen by measurement, not by argument — on the four documents of the #405 exhibit set that closed on a stub page, every position in the last two sections that can carry a break was tried, and a break on a section was the only move that cleared all four. Keeping the notes with the paragraph above them, which the earlier advice suggested, cleared one; moving the notes ahead of the closing prose cleared none. The recorded documents are the regression inputs (`packages/design-evals/src/last-page-repair.test.ts`).

Reading order is decided from geometry, which is what lets a wrapped table cell match its own authored text. A row is parted into cells at gaps wider than half a line — and, where cell padding is tighter than that, at any gap the row's own word spacing cannot account for: within one row a word space holds to its median within a hundredth, since justification stretches every space of a line alike, while a cell boundary poppler ran together is close to twice it. A run of rows that resolves into more than one column reads column by column, so a cell's lines come out together even when no single row holds two cells — a figure centred between the two lines of the label beside it parts them exactly as a full row of cells does. A bare-digits row inside a page band is a page number only when it stands alone, with no unclaimed row within a line of it, and its height recurs on another page; a table's numeric row that flowed into the band on one page is neither, and keeps its own occurrence.

`context.mapping` on every finding is `mapped`, `ambiguous` (one side of a pair) or `unmapped` (no authored string owns the words; reported at the document root, never dropped), and the `rendered` summary counts inventory entries and findings by outcome. Two kinds of string are painted without being authored where they show, and the inventory lists them where they render so they cannot steal a heading's first occurrence: a table of contents repeats the headings and style-mapped paragraphs it collects (optional entries, since which lines a field collects is the field's decision), and a native chart draws its title, unless hidden, and its axis titles inside the drawing.

The pass is a rule pack of its own (`RENDERED_QUALITY_RULES` in `jto-ops`), run through the same quality engine as the static rules under the same profile and policy `jto_validate` takes — `jto_preview`'s `quality` option, else the profile the document declares, else the format default. A profile can switch a rendered rule off or move its severity, a policy can suppress one at a pointer, and a gate marks findings blocking, and a `maxDiagnostics` budget cuts the list; `rendered.suppressed`, `rendered.blocked`, `rendered.truncated` and `rendered.profileId` say what applied, and a rendered rule that fails is reported as a rule error rather than an empty result. The design guide lists the rendered rules beside the static ones. Generation never runs the pass, so nothing here blocks `jto_generate`. It runs over geometry the caller extracts (`analyzeRenderedDocument`), so it is testable from captured fixtures without a converter, and a rendered preview prepares the document once: the same prepared model is generated from and mapped through.

A labelled mapping corpus (`preview-rendered-mapping-corpus.test.ts`, converter-dependent) pins the mapping on report-shaped documents: duplicate strings in two tables and a contents page, ligature-prone words, running chrome around a paragraph that breaks across pages, a family declared with a source that cannot load, a native chart's titles and a frame whose tail never rendered. Every entry is labelled with the page it must land on; precision and recall against the labels are 1.0 on 33 entries, above the ≥0.95 / ≥0.90 targets of #344.

## Charts and tables

Both formats ask the same questions of a chart and of a table, because both are
questions about the numbers rather than about the file. The rules are written
once and each format translates its own props into them, so a slide chart, a
document chart and a Highcharts config are judged by one standard.

### Charts

`W_QUALITY_CHART_3D` is the only one of these that is never a matter of taste.
A perspective projection makes the front of the plot read larger than the back,
so the comparison the chart exists for is the thing the depth distorts. PPTX
spells it `bar3D`; a Highcharts config spells it `chart.options3d.enabled`. The
DOCX chart component has no 3D type at all.

`W_QUALITY_CHART_OVERLOADED` is one code for two counts, because they are the
same failure measured differently: more than six slices in a pie or a doughnut,
or more than four series anywhere else. Which count applies is decided by how
the chart encodes value — a pie encodes with angle, and wedges within a few
degrees of each other cannot be ranked by eye; a line encodes with position,
where twelve months is a time series and not an overloaded chart. The limits
are the `maximumSlices` and `maximumSeries` parameters.

`W_QUALITY_CHART_AXIS_BASELINE` fires only where the chart encodes with
_length_: a bar twice as long has to mean twice as much, so a value axis that
starts at 80 draws a 2% difference as a doubling. A line chart with the same
floor is left alone — zooming the axis is how a small movement is made visible,
and position carries no claim about ratios. Only an authored floor counts; a
chart that states none gets the renderer's, which starts at zero. The DOCX
chart component has no axis-floor property, so this reaches DOCX only through
Highcharts.

`W_QUALITY_CHART_SERIES_COLORS` reports a chart with no series colours, which
paints in the renderer's default palette — the one that belongs to no document.
The fix names one theme token per series, drawn from `primary`, `accent`,
`secondary` and the optional `accent4`–`accent6` slots, cycling if the chart has
more series than the theme has slots. `background` and `text` are excluded: a
series painted in either disappears into the slide. No fix is offered for a
Highcharts chart — its palette lives inside an options object the schema keeps
opaque and the export server reads verbatim, so writing into it would mean
guessing at a structure nothing here validated.

`W_QUALITY_CHART_UNITS` is `info`, and generous about what counts as naming a
unit: a value-axis label format, percent data labels, a percent-stacked bar, or
a unit marker in the value-axis title, the chart title or the caption — a
currency or percent sign, a parenthesised suffix like `(€m)`, or one of a short
list of unit words. A quantity named without its unit is not a unit: `Revenue`
does not count and `Revenue (€m)` does. It advises rather than warns because
the unit may well be in the sentence beside the chart, which the analyzer
cannot see.

`W_QUALITY_CHART_ANNOTATION` is asked only of a chart that _has_ somewhere to
put the answer. A DOCX chart has `props.caption`; a Highcharts config has
`caption.text` and `subtitle.text`. A native PPTX chart has neither, so it is
never asked — a rule that judges a slot the component does not have is a rule
nobody can satisfy. When blocks arrive, the takeaway and source slots they
carry will be judged the same way.

### Tables

A column is numeric when at least two of its body cells parse as numbers and no
other cell is text. Blanks, dashes, `n/a` and `TBD` are gaps rather than text —
real tables are full of them, and reading one as prose would hide exactly the
column most likely to have been laid out without thought. Two numbers is the
floor: a single figure beside a label is a fact, not a column.

Number parsing is positional rather than locale-aware, because there is no
universal answer — `1.234` is one thousand two hundred and thirty-four in Milan
and one-point-two-three-four in Chicago. Exactly three digits after the last
separator is read as a thousands group and anything else as a decimal fraction,
which reads `50,00` as fifty and `1,234` as one thousand two hundred and
thirty-four. Currency symbols, percent signs, accounting parentheses and
magnitude suffixes (`k`, `m`, `bn`, `pp`, `bps`) are notation and are stripped
before parsing.

`W_QUALITY_TABLE_NUMERIC_ALIGN` reports a numeric column that is not flush
right, where digits do not line up by place value. Alignment is read through
each format's own cascade rather than off the cell, so a table that sets the
alignment once for every cell in it is not reported as if every cell were
silent. The repair is the one place the two formats genuinely differ: a DOCX
table is column-major, so the fix is one operation on the column's
`cellDefaults` plus one for the header and one for any cell that stated an
alignment of its own; a PPTX table is row-major and has no column to patch, so
the fix is one operation per row, and a plain-string cell becomes an object to
carry the alignment at all.

`W_QUALITY_TABLE_MIXED_DECIMALS` reports a numeric column rounded more than one
way. It carries no fix: padding `3` to `3.00` is a claim about precision the
source may not support, and only the author knows which way the column should
go.

`W_QUALITY_TABLE_GRID` is `info`, and is asked of the table's own declaration
rather than of the resolved borders. Word's baseline is a box around every cell
and every PPTX theme draws a rule between them, so a resolved-border test would
report every table that never mentioned its borders — one finding per table for
a decision the theme took once, for the whole document. A grid a table asks for
is a choice the author can unmake at the pointer the finding names; a grid it
inherited belongs to a theme review.

`W_QUALITY_TABLE_ROW_COUNT` counts the rows a table draws, header included. It
warns past twelve on a slide, where the canvas is fixed and a thirteenth row is
either unreadable or off the edge, and advises past twenty-five on a page,
where nothing breaks and the limit is about attention rather than about paper.
Both are the `maximumRows` parameter.

A table with merged cells is described without columns and none of the column
findings apply: a `colspan` breaks the correspondence between an index and a
visual column, and every column finding is about what sits under what.

## Profiles

A profile describes the intended document class. It supplies rule parameters and
severity defaults; it does not decide whether a run blocks. A document may name
the profile it wants judged by in `props.qualityProfile`; validation without a
profile argument uses it, a profile the caller passes wins, and an unknown name
falls back to the format default. A [blueprint](/reference/blueprints) scaffold
writes its archetype's profile there, so the first `jto_validate` already judges
against the right bar.

You can create a profile with any unique string `id`; it does not need to be
registered with json-to-office. Save the object as JSON for the CLI, or pass the
same object directly through the library, HTTP or MCP APIs.

| Profile                  | Format | Difference from the format default                                                                                                                                                                                                                                                                                                                    |
| ------------------------ | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `technical-presentation` | PPTX   | Default PPTX profile                                                                                                                                                                                                                                                                                                                                  |
| `executive-presentation` | PPTX   | 14pt minimum font; at most 70 body words per slide                                                                                                                                                                                                                                                                                                    |
| `consulting-deck`        | PPTX   | Requires `takeaway` and `source` slots, bounds action titles at two lines, at most 90 body words, every size on the theme scale with at most eight in play, and every title of one kind on one line                                                                                                                                                   |
| `general`                | DOCX   | Default DOCX profile: integrity and information-design rules at their defaults, nothing required by structure                                                                                                                                                                                                                                         |
| `client-report`          | DOCX   | Requires a running head with page numbers on every section after the first, `takeaway` and `source` slots wherever a block declares them, promotes heading skips, rendered empty pages and under-filled pages to warnings, enables the three theme-consistency rules and requires at least one chart or table; the `client-report` blueprint names it |
| `technical-report`       | DOCX   | As `client-report`, but owes a figure only its `source`, never a `takeaway`, and allows nine text sizes for the contents list and sub-headings; the `technical-report` blueprint names it                                                                                                                                                             |
| `executive-report`       | DOCX   | Promotes heading skips from info to warning                                                                                                                                                                                                                                                                                                           |
| `legal-appendix`         | DOCX   | Current integrity-focused DOCX defaults                                                                                                                                                                                                                                                                                                               |

### Create a profile

For example, save this as `board-deck.json`:

```json
{
  "id": "board-deck",
  "version": "1.0.0",
  "description": "Internal board presentation standard",
  "formats": ["pptx"],
  "rendererTargets": ["pptxgenjs"],
  "rules": {
    "pptx/minimum-font-size": {
      "parameters": { "minimumFontPt": 16 }
    },
    "pptx/slide-density": {
      "severity": "error",
      "parameters": { "maximumBodyWords": 60 }
    },
    "pptx/text-fit": {
      "severity": "warning"
    }
  }
}
```

Then select it for validation or generation:

```bash
jto pptx validate deck.json --quality-profile board-deck.json
jto pptx generate deck.json --quality-profile board-deck.json
```

A custom profile starts from every rule's built-in defaults. Omitting a built-in
rule does not disable it; set `{ "enabled": false }` for that rule when needed.
There is currently no `extends` field: a custom ID does not inherit a shipped
profile such as `executive-presentation`.

Profiles configure rules already installed in the selected quality engine. An
unknown rule ID is not installed or evaluated. Adding a genuinely new check
requires a custom `QualityRule`/`QualityEngine`, not only a profile entry.

### Customize a shipped profile

To adjust a shipped profile, keep its shipped ID and override only what differs.
Rule configuration merges field by field, so shipped parameters not mentioned
here remain in force:

```json
{
  "id": "executive-presentation",
  "formats": ["pptx"],
  "description": "Board deck",
  "rules": {
    "pptx/minimum-font-size": {
      "parameters": { "minimumFontPt": 16 }
    },
    "pptx/slide-density": {
      "severity": "error"
    }
  }
}
```

Profiles may also declare `version`, `description`, `rendererTargets` and
top-level `parameters`. A profile that does not support the current format or
renderer is rejected instead of silently running under the wrong assumptions.

## Policies and gates

A policy controls one run. It can override rules, suppress accepted exceptions,
limit output and decide when findings block:

```json
{
  "rules": {
    "pptx/text-fit": {
      "severity": "error",
      "parameters": {
        "characterWidthFactor": 0.48,
        "safetyBufferPt": 10
      }
    },
    "pptx/slide-density": { "enabled": false }
  },
  "suppressions": [
    {
      "code": "W_QUALITY_FONT_SIZE_MIN",
      "path": "/children/8",
      "pathMatch": "subtree",
      "reason": "Approved legal footer"
    }
  ],
  "gate": "warning",
  "maxDiagnostics": 100,
  "onRuleError": "throw"
}
```

Configuration precedence is:

1. rule defaults;
2. profile-wide parameters;
3. profile rule configuration;
4. policy rule configuration.

Later layers win. A rule can be enabled or disabled, assigned a severity and
given parameters at the profile or policy level.

### Gate thresholds

The threshold is inclusive:

| Gate      | Blocks                             |
| --------- | ---------------------------------- |
| `none`    | Nothing                            |
| `error`   | Errors                             |
| `warning` | Errors and warnings                |
| `info`    | Errors, warnings and info findings |

Default behavior is `none`. Setting a severity without a gate changes reporting,
not the pass/fail verdict.

### Suppressions

A suppression can select by `ruleId`, `code`, `path`, or a combination. All
provided selectors must match. `pathMatch: "exact"` is the default; `subtree`
also matches descendants. A selector-free suppression matches nothing, and every
suppression requires a reason so exceptions remain auditable.

Suppressed findings are removed from `diagnostics` and counted in
`suppressedCount`.

::: warning Validate hand-written policy JSON
The TypeScript contract requires `reason` and constrains suppression fields.
Runtime validation currently checks the gate, rule-configuration shape and
severity, diagnostic budget and `onRuleError`; it does not fully schema-check
suppressions or arbitrary rule parameters. JSON callers should validate or
construct those fields carefully.
:::

### Budgets and rule errors

`maxDiagnostics` is a non-negative integer and acts as an output budget. When it
removes findings, `truncated` is true. Blocking findings are always retained, so
the returned list can exceed the budget rather than hide why a gate failed.

`onRuleError` controls an unexpected exception from a rule:

- `continue` (the default) records the failure in `ruleErrors` and evaluates
  other rules;
- `throw` stops analysis and throws the underlying error.

A continued rule error does not itself create a blocking diagnostic. Use
`onRuleError: "throw"` when CI must fail closed on faulty custom rules.

If preparing the document fails, analysis records `quality/prepare`. An active
gate fails closed because no reliable quality verdict could be produced; an
advisory run remains unblocked. Structural validation should normally catch the
malformed input first.

## Suggested fixes

Some deterministic or bounded findings include RFC 6902 operations in `fixes`:

- raise a font to the configured minimum;
- reduce a text font when a readable whole-number size fits the box;
- proportionally scale fully explicit DOCX column widths;
- replace a skipped heading level with the next valid level;
- map an off-palette literal to the nearest theme token;
- name one theme colour per series on a chart that states none;
- right-align a numeric table column, header included.

Fixes are proposals, not automatic mutations. Review them before applying them,
especially when reducing type size would preserve fit but harm the design intent.
When no safe patch exists, the diagnostic still supplies a suggestion.

## Programmatic analysis

The analyzers are exported by the format cores:

```ts
import { analyzeDocxQuality } from '@json-to-office/core-docx';
import { analyzePptxQuality } from '@json-to-office/core-pptx';

const pptxAnalysis = analyzePptxQuality(deck, {
  profile: { id: 'executive-presentation', formats: ['pptx'] },
  policy: { gate: 'warning' },
});

if (pptxAnalysis.blocked) {
  throw new Error('Deck did not meet the quality policy');
}

const docxAnalysis = analyzeDocxQuality(report, {
  policy: { gate: 'error' },
});
```

These functions are not re-exported by `@json-to-office/json-to-docx` or
`@json-to-office/json-to-pptx`. Direct calls to the core generation functions do
not automatically enforce a quality policy either: analyze explicitly and act on
`blocked`. The CLI, HTTP server and MCP server integrate analysis into their
validation/generation flows.

For advanced integrations, the cores also export their prepared-document
functions, built-in rule packs, profiles and engines. The
`@json-to-office/quality` package exports `QualityEngine` and the shared rule,
profile, policy and diagnostic types, so an application can add its own rule pack
without changing the format cores.

## HTTP and MCP

HTTP validation and generation accept quality settings under `options.quality`:

```json
{
  "jsonDefinition": {
    "name": "pptx",
    "props": {},
    "children": []
  },
  "options": {
    "quality": {
      "profile": {
        "id": "executive-presentation",
        "formats": ["pptx"]
      },
      "policy": { "gate": "warning" }
    }
  }
}
```

The MCP `jto_validate` tool accepts the same profile and policy objects under
`quality`. It returns evidence-rich diagnostics as repair targets; `ok` changes
only when structural validation fails or the requested quality gate blocks. See
[The MCP server](/guide/mcp-server).
