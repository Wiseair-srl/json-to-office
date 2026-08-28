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

| Rule                     | Codes                                                                                     | Default                              | Certainty     | What it checks                                             |
| ------------------------ | ----------------------------------------------------------------------------------------- | ------------------------------------ | ------------- | ---------------------------------------------------------- |
| `pptx/canvas`            | `W_QUALITY_CANVAS_UNSPECIFIED`, `W_QUALITY_CANVAS_NONSTANDARD`, `W_QUALITY_CANVAS_LEGACY` | warning when missing; otherwise info | deterministic | Missing, legacy 4:3 or nonstandard canvas dimensions       |
| `pptx/minimum-font-size` | `W_QUALITY_FONT_SIZE_MIN`                                                                 | warning                              | measured      | Effective text size below `minimumFontPt` (7pt by default) |
| `pptx/text-fit`          | `W_QUALITY_TEXT_OVERFLOW`, `W_QUALITY_TEXT_TIGHT`                                         | warning for overflow; otherwise info | estimated     | Estimated text height exceeds, or nearly fills, its box    |
| `pptx/slide-density`     | `W_QUALITY_SLIDE_DENSITY`                                                                 | warning                              | estimated     | Body text exceeds `maximumBodyWords` (130 by default)      |

The canvas rule recognizes these deliberate presets: 16:9 standard
(`13.333 × 7.5`), 16:9 small (`10 × 5.625`), square (`7.5 × 7.5`), 4:5
vertical (`7.5 × 9.375`) and 9:16 story (`4.5 × 8`). If no size is declared,
the renderer uses a 10 × 7.5 inch 4:3 canvas, so the missing-canvas finding is a
warning rather than informational.

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
- The analyzer does not render slides. It cannot judge overlaps, contrast,
  image quality, alignment, factual correctness or narrative quality.

These omissions are deliberate. Missing evidence produces no finding rather
than a confident-sounding guess.

## Built-in DOCX rules

| Rule                     | Code                             | Default | Certainty     | What it checks                                                                                     |
| ------------------------ | -------------------------------- | ------- | ------------- | -------------------------------------------------------------------------------------------------- |
| `docx/table-width`       | `W_QUALITY_TABLE_WIDTH_OVERFLOW` | warning | deterministic | Explicit column widths exceed the usable width of their section, with a 10-twip rounding tolerance |
| `docx/heading-hierarchy` | `W_QUALITY_HEADING_SKIP`         | info    | deterministic | A heading jumps down by more than one level                                                        |

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
