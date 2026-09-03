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
applies the information the renderer will use — themes, defaults, templates,
placeholders, grids, disabled state and section geometry — while preserving RFC
6901 pointers back to the source JSON. Rules then inspect facts from that model.

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

| Rule                     | Codes                                                                                     | Default                                                 | Certainty     | What it checks                                                |
| ------------------------ | ----------------------------------------------------------------------------------------- | ------------------------------------------------------- | ------------- | ------------------------------------------------------------- |
| `pptx/canvas`            | `W_QUALITY_CANVAS_UNSPECIFIED`, `W_QUALITY_CANVAS_NONSTANDARD`, `W_QUALITY_CANVAS_LEGACY` | warning when missing; otherwise info                    | deterministic | Missing, legacy 4:3 or nonstandard canvas dimensions          |
| `pptx/minimum-font-size` | `W_QUALITY_FONT_SIZE_MIN`                                                                 | warning                                                 | measured      | Effective text size below `minimumFontPt` (7pt by default)    |
| `pptx/text-fit`          | `W_QUALITY_TEXT_OVERFLOW`, `W_QUALITY_TEXT_TIGHT`                                         | warning for overflow; otherwise info                    | estimated     | Estimated text height exceeds, or nearly fills, its box       |
| `pptx/slide-density`     | `W_QUALITY_SLIDE_DENSITY`                                                                 | warning                                                 | estimated     | Body text exceeds `maximumBodyWords` (130 by default)         |
| `pptx/text-contrast`     | `W_QUALITY_TEXT_CONTRAST`                                                                 | warning                                                 | deterministic | Text falls below WCAG AA against the surface behind it        |
| `pptx/placeholder-text`  | `W_QUALITY_SCAFFOLD_MARKER`, `W_QUALITY_PLACEHOLDER_TEXT`                                 | warning                                                 | deterministic | An unfilled scaffold slot, or leftover filler text            |
| `pptx/box-overlap`       | `W_QUALITY_BOX_OVERLAP`                                                                   | warning for a duplicate or covered data; otherwise info | deterministic | Two opaque boxes on one slide that land on each other         |
| `pptx/font-count`        | `W_QUALITY_FONT_COUNT`                                                                    | warning                                                 | deterministic | More than `maximumFamilies` (3) font families in one document |
| `pptx/palette-adherence` | `W_QUALITY_OFF_PALETTE`                                                                   | info                                                    | deterministic | A literal colour the resolved theme does not define           |

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
the `{{…}}` marker a scaffold wrote into it. `jto_validate` reports the markers
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

## Built-in DOCX rules

| Rule                     | Code                                                      | Default | Certainty     | What it checks                                                                                     |
| ------------------------ | --------------------------------------------------------- | ------- | ------------- | -------------------------------------------------------------------------------------------------- |
| `docx/table-width`       | `W_QUALITY_TABLE_WIDTH_OVERFLOW`                          | warning | deterministic | Explicit column widths exceed the usable width of their section, with a 10-twip rounding tolerance |
| `docx/heading-hierarchy` | `W_QUALITY_HEADING_SKIP`                                  | info    | deterministic | A heading jumps down by more than one level                                                        |
| `docx/text-fit`          | `W_QUALITY_TEXT_OVERFLOW`                                 | warning | estimated     | A word too wide for its floating frame, or a frame whose wrapped block runs off the sheet          |
| `docx/frame-collision`   | `W_QUALITY_FRAME_COLLISION`                               | warning | estimated     | Two page-anchored floating frames whose estimated text blocks land on the same region of a page    |
| `docx/svg-text-bounds`   | `W_QUALITY_SVG_TEXT_CLIPPED`                              | warning | deterministic | A `<text>` baseline in an inline SVG falls outside the viewBox, so the words are never painted     |
| `docx/line-box`          | `W_QUALITY_LINE_BOX_COLLAPSE`                             | warning | measured      | An `exactly` line box on text is shorter than the capitals it holds                                |
| `docx/placeholder-text`  | `W_QUALITY_SCAFFOLD_MARKER`, `W_QUALITY_PLACEHOLDER_TEXT` | warning | deterministic | An unfilled scaffold slot, or leftover filler text                                                 |

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
typography, whitespace, widow/orphan behavior, table readability, color or the
visual result produced by Word.

## Profiles

A profile describes the intended document class. It supplies rule parameters and
severity defaults; it does not decide whether a run blocks.

You can create a profile with any unique string `id`; it does not need to be
registered with json-to-office. Save the object as JSON for the CLI, or pass the
same object directly through the library, HTTP or MCP APIs.

| Profile                  | Format | Difference from the format default                 |
| ------------------------ | ------ | -------------------------------------------------- |
| `technical-presentation` | PPTX   | Default PPTX profile                               |
| `executive-presentation` | PPTX   | 14pt minimum font; at most 70 body words per slide |
| `technical-report`       | DOCX   | Default DOCX profile                               |
| `executive-report`       | DOCX   | Promotes heading skips from info to warning        |
| `legal-appendix`         | DOCX   | Current integrity-focused DOCX defaults            |

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
- replace a skipped heading level with the next valid level.

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
