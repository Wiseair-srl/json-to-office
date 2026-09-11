# Skill taste inventory: json-to-office 3.2.0 → 4.0.0

#424 moves document taste out of the `json-to-office` skill and leaves the
skill with the workflow. This is the ledger for that move: every design
instruction the last taste-carrying release made, and where it lives now.
Four dispositions, and nothing is dropped without one.

| Disposition | Meaning                                                                                                |
| ----------- | ------------------------------------------------------------------------------------------------------ |
| product     | The server owns it now: a theme value, a block, a blueprint, a rule, the rubric or a design note.      |
| workflow    | It is a step, not a taste rule; the 4.0.0 skill keeps it.                                              |
| dropped     | Obsolete, wrong, or superseded by how the product composes documents; the reason is stated.            |
| gap         | Useful, and nothing in the product replaces it yet; recorded here, with a task where one is warranted. |

**Source.** Skill 3.2.0 as published in the Wiseair skills store (the
version the 2026-09-05 assisted baseline measured; `SKILL.md` sha256
`c699b732c2c983d93b60fe4bdb6750a9078b8941040803e478a8253c4c58436d`): `SKILL.md`,
six taste files, two cheat-sheets, the theme guide, `preflight.py`, the
template library and its two scripts, and `evals/evals.json` — 130 KB of
prose and scripts beside 4 MB of vendored templates.

**Product.** `@json-to-office/mcp-server` 6.4.0, read the way an agent reads
it: the server instructions, `jto_discover` and its design notes,
`jto://guide/design/<format>` (themes, profiles, rules, blocks, blueprints,
rubric), `jto://themes`, the three prompts.

## How the replacements were verified

A replacement counts only if it was observed. Three kinds of evidence:

- **Rules.** Every rule code cited below was read from the rule packs the
  server publishes in `jto://guide/design/<format>`; each rule carries its own
  positive and negative fixtures in its package.
- **Behaviour.** The anti-patterns the skill warned about were written as
  small documents and sent to `jto_validate` (and, for two of them,
  `jto_generate`) over stdio against the built server on 2026-09-11. The table
  is the evidence; a row that caught nothing is a gap below.
- **Theme values.** Read from `jto://themes`, which describes the resolved
  theme the rules judge against.

| Anti-pattern the skill warned about                       | What the server answered                                                       |
| --------------------------------------------------------- | ------------------------------------------------------------------------------ |
| DOCX `lineSpacing` at the paragraph root                  | refused: `E_UNEXPECTED_PROPERTY`                                               |
| DOCX `characterSpacing` without `type`                    | refused: `E_REQUIRED_PROPERTY`                                                 |
| DOCX `border` on a top-level paragraph                    | refused: `E_UNEXPECTED_PROPERTY`                                               |
| DOCX table given PPTX `rows` / PPTX table given `columns` | refused, both formats                                                          |
| PPTX `fontColor` on a text component                      | refused: `E_UNEXPECTED_PROPERTY`                                               |
| PPTX `transparency` on text                               | refused: `E_UNEXPECTED_PROPERTY`                                               |
| PPTX canvas left undeclared                               | `W_QUALITY_CANVAS_UNSPECIFIED`                                                 |
| DOCX raw hex colour in a run                              | `W_QUALITY_OFF_PALETTE`                                                        |
| DOCX four font families                                   | `W_QUALITY_FONT_COUNT`                                                         |
| DOCX centred numeric column with mixed decimals           | `W_QUALITY_TABLE_NUMERIC_ALIGN`, `W_QUALITY_TABLE_MIXED_DECIMALS`              |
| PPTX pie with nine slices, library colours                | `W_QUALITY_CHART_OVERLOADED`, `W_QUALITY_CHART_SERIES_COLORS`, `…_CHART_UNITS` |
| PPTX 3D bar chart                                         | `W_QUALITY_CHART_3D`                                                           |
| PPTX slide of 140 words                                   | `W_QUALITY_SLIDE_DENSITY`                                                      |
| DOCX lorem ipsum                                          | `W_QUALITY_PLACEHOLDER_TEXT`                                                   |
| DOCX `h3` with no `keepNext`                              | nothing, correctly: every bundled theme's heading styles set `keepNext`        |
| PPTX node placed by `grid` and by `x/y/w/h` at once       | nothing — gap                                                                  |
| DOCX `props.theme` naming no theme                        | nothing at validate; `W_THEME_NOT_FOUND` only at generate — gap                |
| DOCX image at a missing local path                        | nothing at validate; generate fails `E_INTERNAL` — gap                         |
| DOCX italic serif numerals                                | nothing — gap                                                                  |

## SKILL.md

| Instruction                                                                              | Disposition | Where it lives now / why                                                                                                                                                                                                                                             |
| ---------------------------------------------------------------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The skill owns taste rules, the pre-flight and the template set                          | dropped     | Ownership reversed by the epic: themes, blocks, blueprints, rules, rubric and gallery are the server's (spec decision 18).                                                                                                                                           |
| Stop if the `jto_*` tools are absent                                                     | workflow    | Kept.                                                                                                                                                                                                                                                                |
| When to fire (Office deliverables, `.docx.json` edits)                                   | workflow    | Kept as the trigger.                                                                                                                                                                                                                                                 |
| Defer to a brand or design-system skill for tokens                                       | workflow    | Kept, with the mechanism the brand decision below settles: the brand theme is handed to the server, not restated.                                                                                                                                                    |
| Call `jto_info`; preview and Highcharts dependencies gate preview and charts             | workflow    | Kept; also the server instructions' first working rule.                                                                                                                                                                                                              |
| Start from a designed template, never from `{}`                                          | product     | `jto_scaffold` on a blueprint (`client-report`, `technical-report`, `consulting-deck`) opens a structurally complete draft; `jto://templates` bundles the gallery offline (#322, #339, #342).                                                                        |
| Vendored template library, `new_from_template.py`, `vendor_templates.py`                 | dropped     | The gallery ships inside the server package with manifests and thumbnails; a second copy in the skill drifts.                                                                                                                                                        |
| Coverage gap: no invoice, pricing, quote or cover template                               | gap         | No blueprint for those archetypes; the v1 archetypes are decided (spec decision 16). The server's instruction — decide the structure explicitly when no blueprint fits — is the fallback. Accepted.                                                                  |
| Markdown outline → one slide per `##`, ≤5–6 bullets, split long lists, numbers → METRICS | product     | `jto_scaffold` outline mapping for `consulting-deck` (#421): long lists become `(cont.)` slides, tables a two-column evidence column, `Label: figure` bullets KPI rows; `deck-from-outline` prompt; `W_QUALITY_BULLET_COUNT`.                                        |
| Template rotation: no layout more than three slides running                              | dropped     | The blueprint composes the sequence from blocks; sameness is what the judge's genericness score measures.                                                                                                                                                            |
| Speaker notes carry the outline's text                                                   | gap         | Nothing writes or requires slide notes. Recorded; not filed — no brief in the corpus asks for a presented deck.                                                                                                                                                      |
| Chunk big decks: skeleton, then batches of five to eight                                 | workflow    | The scaffold is the skeleton; the skill keeps "patch in batches, validate between".                                                                                                                                                                                  |
| Read the taste files before editing                                                      | product     | `jto://guide/design/<format>`: themes, profiles, rules, blocks, blueprints and rubric in one page, generated from what `jto_validate` enforces.                                                                                                                      |
| Cheat-sheets for props                                                                   | product     | `jto_describe_component` (one component's schema under one renderer) and the design note on every component in `jto_discover`.                                                                                                                                       |
| Six-line design-direction brief, shown before authoring                                  | product     | The `design-brief` prompt (#348) writes the six-line brief — audience, purpose, the one thing, length, tone, constraints — then chooses blueprint and theme. Aesthetic lines (palette, type, motif) are the theme's.                                                 |
| Theme guide: `minimal`, `corporate`, `modern`, `apex`; pptx `default`, `dark`            | dropped     | Wrong since the theme rework: `corporate`, `modern` and `apex` do not exist. `jto_discover.themes` and `jto://themes` list what does, with `whenToUse`.                                                                                                              |
| Theme tokens, not hex                                                                    | product     | `W_QUALITY_OFF_PALETTE` in both formats (verified above); server instructions.                                                                                                                                                                                       |
| Use the PPTX grid; never pixel-place                                                     | product     | PPTX blocks place by frame (#340, #341); `W_QUALITY_SAFE_AREA`, `W_QUALITY_BOX_OVERLAP`, `W_QUALITY_OFF_CANVAS`, `W_QUALITY_TITLE_DRIFT`. Coordinates stay the escape hatch.                                                                                         |
| One idea per slide; >40 words, split                                                     | product     | `W_QUALITY_SLIDE_DENSITY` (verified), block slot budgets (`W_QUALITY_SLOT_BUDGET`).                                                                                                                                                                                  |
| Tabular figures on numbers                                                               | gap         | No schema field sets figure style. The house theme's faces (Arial, Calibri) set lining figures by default; accepted.                                                                                                                                                 |
| Don't invent component names                                                             | product     | Schema validation refuses unknown components; `jto_discover` lists what exists.                                                                                                                                                                                      |
| Use a workspace for long documents                                                       | workflow    | Kept; scaffolding opens one.                                                                                                                                                                                                                                         |
| Validate with a hand-picked quality profile                                              | product     | The scaffold writes the archetype's `qualityProfile` into the document and `jto_validate` judges by it; `generationReady` says when no slot is owed.                                                                                                                 |
| Run `preflight.py`, a stricter text-fit estimate                                         | dropped     | `W_QUALITY_TEXT_TIGHT` / `…_TEXT_OVERFLOW` estimate, and the rendered pass measures: `W_QUALITY_RENDERED_CLIP`, `…_SPILL`, `…_OVERLAP`, `…_TEXT_MISSING` (#344). The assisted baseline showed the script making it worse (`W_QUALITY_TEXT_TIGHT` 17 → 110 findings). |
| Preview, then read every PNG; the inspection checklist                                   | product     | `jto_preview` contact sheet and rendered findings; `jto_critique inspect` hands over the evidence and the rubric (#345). The checklist items are rules: contrast, title drift, role drift, density, measure, chart design.                                           |
| Fonts: substitute, Google Fonts, strict                                                  | product     | `jto_generate` font options; house theme on safe fonts only (spec decision 19); `W_QUALITY_RENDERED_FONT_SUBSTITUTED`.                                                                                                                                               |
| Re-read the template JSON against the PNGs                                               | dropped     | Blocks compile from definitions with source maps; a slot fill cannot break a block's chrome.                                                                                                                                                                         |
| Iterate; three rounds for polish; never ship integrity defects                           | product     | `jto_critique record` counts rounds against the exact revision and stops at three; `jto_generate` refuses unfilled scaffold slots.                                                                                                                                   |
| Final validate, then generate the accepted revision; never patch after                   | workflow    | Kept.                                                                                                                                                                                                                                                                |
| `jto_docx_diff` for a reviewable redline                                                 | workflow    | Kept.                                                                                                                                                                                                                                                                |
| Capture a gotcha in the skill's gotchas file                                             | dropped     | A silent failure is a product defect; the skill now says to report it, not to write it into prose.                                                                                                                                                                   |
| Report: artifact path, what was done, preview unavailability                             | workflow    | Kept.                                                                                                                                                                                                                                                                |
| Schema cheat-sheet                                                                       | dropped     | `jto_discover` is the live list.                                                                                                                                                                                                                                     |
| Editing an existing `.docx.json`                                                         | workflow    | Kept: open a workspace from it, validate, preview, patch, generate.                                                                                                                                                                                                  |

## Anti-patterns (SKILL.md)

| Instruction                                      | Disposition | Where it lives now / why                                                      |
| ------------------------------------------------ | ----------- | ----------------------------------------------------------------------------- |
| Hardcoded hex in component props                 | product     | `W_QUALITY_OFF_PALETTE`                                                       |
| More than three typefaces                        | product     | `W_QUALITY_FONT_COUNT`                                                        |
| Italic numbers                                   | gap         | No rule; see the verification table. Accepted as low risk on the house faces. |
| Body text walls on slides                        | product     | `W_QUALITY_SLIDE_DENSITY`                                                     |
| Three-column slide layouts                       | dropped     | No deck block offers three columns; free-form slides are the escape hatch.    |
| Default chart colours                            | product     | `W_QUALITY_CHART_SERIES_COLORS`; Highcharts palette and type from the theme.  |
| Centred numeric columns                          | product     | `W_QUALITY_TABLE_NUMERIC_ALIGN`                                               |
| Borders on every table cell                      | product     | `W_QUALITY_TABLE_GRID`; the `data-table` block rules by the theme's recipe.   |
| Skipping the render loop                         | product     | `jto_preview`, `jto_critique`; the workflow step stays in the skill.          |
| Ignoring `W_QUALITY_*` because the schema passed | product     | Server instructions: treat design findings as defects.                        |
| Skipping the pre-flight                          | dropped     | See `preflight.py` above.                                                     |
| Authoring from `{}`                              | product     | `jto_scaffold`                                                                |
| Dangling image paths                             | gap         | Silent at validate; generation fails as `E_INTERNAL`. Task filed.             |

## assets/taste/gotchas.md

| Instruction                                                              | Disposition | Where it lives now / why                                                                                                                                                             |
| ------------------------------------------------------------------------ | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Table orientation: DOCX `columns`, PPTX `rows`                           | product     | Schema refuses the other shape in both formats (verified).                                                                                                                           |
| `keepNext` on every `h3` and deeper                                      | product     | Every bundled theme binds its heading styles; `W_QUALITY_HEADING_ORPHAN` catches a heading that unbinds itself; `W_QUALITY_RENDERED_HEADING_STRANDED` sees one stranded on the page. |
| `lineSpacing` belongs inside `font`                                      | product     | Schema refuses it at the root (verified).                                                                                                                                            |
| `characterSpacing` needs `type` and `value`                              | product     | Schema (verified).                                                                                                                                                                   |
| No `border` on a top-level paragraph                                     | product     | Schema (verified); the `divider` component draws a rule.                                                                                                                             |
| Headers and footers vanish after the first section                       | product     | The `running-head` block and chrome recipes paint them; following sections inherit (#335, #402); `docx/running-head` rule under the report profiles.                                 |
| Table widths past the page                                               | product     | `W_QUALITY_TABLE_WIDTH_OVERFLOW`                                                                                                                                                     |
| Cell `color` is text, `backgroundColor` fill; header defaults overridden | product     | The `data-table` block takes its header and rules from the theme; the property names are in `jto_describe_component`.                                                                |
| Cover paragraphs inflated by the Normal style                            | product     | The `cover` block (#335, #407 masthead).                                                                                                                                             |
| Hex prefix: `#` in DOCX, bare in PPTX                                    | product     | Theme tokens are the rule (`W_QUALITY_OFF_PALETTE`); the schema states each surface's form.                                                                                          |
| `visual` needs a rasterizer; units in inches; PPTX colours inside        | product     | `jto_info.previewDependencies`; `jto_describe_component visual`.                                                                                                                     |
| PPTX canvas defaults to 4:3                                              | product     | `W_QUALITY_CANVAS_UNSPECIFIED` / `…_CANVAS_LEGACY` (verified); the deck blueprint declares 13.333 × 7.5.                                                                             |
| Theme file `name` must match `props.theme`                               | gap         | A name matching nothing is silent at validate; generate warns `W_THEME_NOT_FOUND` and falls back. Task filed.                                                                        |
| `color` on text, `fontColor` on shapes                                   | product     | Schema refuses `fontColor` on text (verified).                                                                                                                                       |
| No `transparency` on text                                                | product     | Schema (verified).                                                                                                                                                                   |
| Grid or absolute, never both                                             | gap         | Accepted silently (verified). Blocks place by frame, so only free-form slides can meet it; recorded.                                                                                 |
| A `fontSize` override needs a `lineSpacing` override                     | product     | Type roles set size and leading together; `W_QUALITY_TEXT_TIGHT` and the rendered pass catch the miss.                                                                               |
| 4 pt baseline; only the documented sizes                                 | product     | The theme's spacing scale and type roles; `W_QUALITY_TYPE_OFF_SCALE`, `…_TYPE_SIZE_COUNT`, `…_TYPE_ROLE_DRIFT` under the archetype profiles. The literal 4 pt arithmetic is dropped. |
| `rowSpan` sized to the lines that fit                                    | dropped     | Frames and slot budgets replace grid-row sizing.                                                                                                                                     |
| Ellipse aspect on non-square slides                                      | dropped     | Decoration is the theme's motif now, not hand-placed shapes.                                                                                                                         |
| `valign: top` for variable text                                          | dropped     | Block definitions set it.                                                                                                                                                            |
| Speaker notes on every slide                                             | gap         | See SKILL.md above.                                                                                                                                                                  |
| Validate → pre-flight → preview → read                                   | workflow    | Kept as validate → preview → critique; the pre-flight step is gone.                                                                                                                  |
| No lorem ipsum; real numbers                                             | product     | `W_QUALITY_PLACEHOLDER_TEXT` (verified).                                                                                                                                             |
| Placeholder images from placehold.co                                     | dropped     | A network dependency the product does not want in documents.                                                                                                                         |
| Keep diacritics and elision apostrophes                                  | workflow    | Content fidelity, not taste; the skill keeps one line on writing the user's language faithfully.                                                                                     |
| A missing image kills the render                                         | gap         | As above; task filed.                                                                                                                                                                |

## assets/taste/typography.md

| Instruction                                            | Disposition | Where it lives now / why                                                                                                                                               |
| ------------------------------------------------------ | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Serif / sans / mono triad; named families              | product     | The theme's heading and body faces (consulting: Arial over Calibri, safe fonts only); `W_QUALITY_FONT_COUNT`.                                                          |
| Tabular figures; never italic serif numbers            | gap         | See above.                                                                                                                                                             |
| Type scale for slides and pages                        | product     | Theme type roles and scale per canvas, resolved in `jto://themes`; the type rules under the archetype profiles.                                                        |
| Leading 1.5–1.7 body, 1.02–1.10 display; measure 45–75 | product     | Theme styles set leading per role; `W_QUALITY_BODY_MEASURE` judges the measure at the value measured on the bundled themes (125 characters under the report profiles). |
| Hierarchy by size, not bold; italic for tone           | product     | Theme styles; the role rules keep one role at one size.                                                                                                                |
| Eyebrows on every non-title section                    | product     | `section-opener` block and the `tracker` chrome recipe.                                                                                                                |
| Diacritics                                             | workflow    | See gotchas.                                                                                                                                                           |

## assets/taste/tables.md

| Instruction                                         | Disposition | Where it lives now / why                                                                             |
| --------------------------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------- |
| Tinted header, row rules, no grid, generous padding | product     | `data-table` block and the theme's table defaults; `W_QUALITY_TABLE_GRID`.                           |
| Column widths inside the page                       | product     | `W_QUALITY_TABLE_WIDTH_OVERFLOW`; the block sizes its columns.                                       |
| Text left, numbers right                            | product     | `W_QUALITY_TABLE_NUMERIC_ALIGN` (verified).                                                          |
| Consistent decimals down a column                   | product     | `W_QUALITY_TABLE_MIXED_DECIMALS` (verified).                                                         |
| Currency once, in the header                        | gap         | No table rule reads units (`W_QUALITY_CHART_UNITS` covers charts). Recorded.                         |
| Row count: split long tables                        | product     | `W_QUALITY_TABLE_ROW_COUNT`; `data-table` is bounded at 24 rows; `rendered/table-split` on the page. |
| Status pills, inline bars and sparklines            | dropped     | No component draws them; out of the programme's scope.                                               |
| Cells wrapping four lines or more                   | gap         | Nothing measures it. Recorded.                                                                       |

## assets/taste/chart-design.md

| Instruction                              | Disposition | Where it lives now / why                                                                                                                                         |
| ---------------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pick the chart type from the comparison  | product     | The `chart` and `highcharts` design notes; `W_QUALITY_CHART_OVERLOADED` (verified).                                                                              |
| One accent per series, derived hues      | product     | Theme chart palette; `W_QUALITY_CHART_SERIES_COLORS` (verified); Highcharts typography from the theme (#354).                                                    |
| Padding, tick counts, bar width, strokes | dropped     | Renderer and theme defaults; the `chart-figure` block frames the chart.                                                                                          |
| Units in the axis title                  | product     | `W_QUALITY_CHART_UNITS` (verified).                                                                                                                              |
| No 3D, glow or gradients                 | product     | `W_QUALITY_CHART_3D` (verified).                                                                                                                                 |
| Bar axis from zero                       | product     | `W_QUALITY_CHART_AXIS_BASELINE`.                                                                                                                                 |
| A takeaway, not a label, above the chart | product     | `chart-figure` and `action-chart` blocks; `W_QUALITY_CHROME_MISSING` for an empty takeaway or source under the archetype profiles; `W_QUALITY_CHART_ANNOTATION`. |
| Legend only for several series           | dropped     | Renderer default.                                                                                                                                                |

## assets/taste/slide-composition.md and layout-system.md

| Instruction                                              | Disposition | Where it lives now / why                                                                               |
| -------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------ |
| 16:9 canvas; safe area inset                             | product     | Theme canvas (consulting: 0.5 in safe area, 12 × 8 grid on 16:9); `W_QUALITY_SAFE_AREA`; canvas rules. |
| Four archetypal slides: title, divider, two-column, stat | product     | Deck blocks `cover`, `statement`, `two-column`, `kpi-row`, `action-chart` (#341).                      |
| Page strip: n / N, rule, meta, same weight both sides    | product     | Chrome recipes `confidentialFooter` and `sourceLine` drawn by the deck blocks (#361).                  |
| Eyebrow style decided once per deck                      | product     | Blocks draw it from the theme, so it cannot vary; `W_QUALITY_TITLE_DRIFT`.                             |
| Every slide has a title                                  | product     | `W_QUALITY_SLIDE_UNTITLED`; `W_QUALITY_ACTION_TITLE_LENGTH` under `consulting-deck`.                   |
| Spacing scale, grid and margin presets                   | product     | Theme `spacing` and canvas.                                                                            |
| Display and hero character ceilings                      | product     | Slot budgets on the deck blocks; `W_QUALITY_ACTION_TITLE_LENGTH`.                                      |
| Decorative anchor patterns                               | product     | The theme's `motif` (#361) and the deck's motif blocks.                                                |
| `lineSpacing` rules and worked example                   | product     | Type roles; `W_QUALITY_TEXT_TIGHT`; rendered pass.                                                     |
| Prop confusions                                          | product     | Schema (verified).                                                                                     |

## assets/taste/design-direction.md and assets/themes/README.md

| Instruction                                               | Disposition | Where it lives now / why                                                       |
| --------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------ |
| Commit to a direction before authoring; show it; it binds | product     | The `design-brief` prompt; the theme binds by construction.                    |
| Palette, type, memorable thing                            | product     | The theme's palette, faces and motif.                                          |
| Skip the brief when a brand skill is active               | workflow    | Kept, in the brand-theme form below.                                           |
| One-off accent through `themeOverrides`                   | product     | DOCX `props.themeOverrides`; PPTX takes a whole theme inline in `props.theme`. |
| Don't take a dark theme for a body-heavy document         | product     | Each theme's `whenToUse`.                                                      |
| Overriding every token means authoring a theme            | product     | The Wiseair decision below.                                                    |

## scripts, templates and evals

| Item                                                  | Disposition | Where it lives now / why                                                                                                             |
| ----------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `preflight.py`                                        | dropped     | See above.                                                                                                                           |
| `new_from_template.py`, `vendor_templates.py`, bundle | dropped     | `jto_scaffold`, `jto://templates`.                                                                                                   |
| `evals/evals.json`                                    | workflow    | Rewritten in 4.0.0 as workflow expectations: scaffold used, validate clean, critique recorded, generated from the accepted revision. |

## The gaps, in one place

| Gap                                                   | What happens to it                                                               |
| ----------------------------------------------------- | -------------------------------------------------------------------------------- |
| Unknown theme name silent at validate                 | Filed as a follow-up task: report it at validate, as generate already does.      |
| Missing local image silent at validate; `E_INTERNAL`  | Same task: report it at validate, and give generation's failure a document code. |
| Grid and absolute placement on one PPTX node          | Recorded. Only free-form slides can meet it; blocks place by frame.              |
| Tabular figures; italic numerals                      | Accepted: no schema field, and the house faces set lining figures.               |
| Speaker notes                                         | Recorded; no brief asks for a presented deck.                                    |
| Units once in a table header; cells wrapping 4+ lines | Recorded; candidates for the information-design rules when a brief shows them.   |
| Invoice, pricing and quote archetypes                 | Accepted: out of the v1 archetypes (spec decision 16).                           |

## The Wiseair extended-theme decision

Decided by Paolo on 2026-09-11, recorded as spec decision 31: **the
Wiseair design-system skill emits a full extended theme** — palette roles,
type roles and scale, spacing, chrome recipes and motif, for both formats —
rather than a token overlay on the house theme or no brand layer at all.

Why: the product's guarantees are theme-relative. Every consistency rule
reads its values from the resolved theme, so a brand document authored on a
complete extended theme is judged by the same rules as one on `consulting`,
and sends as well as the house reports do (Paolo shipped 22 of 24 on the
exhibit-rule set). A token overlay would keep consulting's structure and only
recolour it.

What the decision commits to, and what it does not:

- **No Wiseair theme in this repository** (spec decision 14). The theme lives
  with the design-system skill, which owns the brand.
- **The theme reaches the server by value.** The option as chosen named
  `themePath`, which today reaches `jto_generate`, `jto_preview`,
  `jto_docx_diff` and `jto_discover` but not `jto_validate`, `jto_critique`,
  `jto_scaffold` or the workspace tools — so the rules would judge a brand
  document against the wrong theme. And in Claude Desktop a skill's files are
  not on the MCP server's filesystem, so a path has nothing to point at. The
  theme therefore travels in the document: PPTX already accepts a complete
  theme inline in `props.theme`, and every tool sees it; DOCX accepts only a
  theme name plus `props.themeOverrides`, which cannot carry page setup or
  component defaults. DOCX theme-by-value is the product work this decision
  creates. Verified on the PPTX side: a deck carrying a copy of `consulting`
  inline, with its accent changed, is judged against the inline palette — the
  new accent passes, the old one is off-palette. One defect found doing so:
  the palette rule also lints the inline theme's own `componentDefaults`
  (`/props/theme/componentDefaults/chart/valGridLine/color`), which the named
  theme never triggers; filed as a follow-up task.
- **The skill tracks the served theme schema.** `jto://schema/docx/theme` and
  `jto://schema/pptx/theme` are the contract a brand theme is validated
  against; a major release that changes them is a breaking change the brand
  theme must follow.
