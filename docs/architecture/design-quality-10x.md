# Design quality 10x

Program spec. Status: **decided** 2026-09-02, critically revised 2026-09-03;
§11 records every decision. Scope: the MCP authoring path
(`@json-to-office/mcp-server`) and the packages it composes. Companion to
`taste-system.md`, which defines the quality model, the evidence axis and the
package boundaries; this spec extends it and does not replace it.

## 1. Goal

Raise the average design quality and taste of documents produced through the
MCP server by an order of magnitude: extremely professional, modern,
well-architected DOCX and PPTX by default, with no designer in the loop.

Target user and authoring surface: **Paolo and Wiseair, on Claude Desktop**,
with the server running locally (LibreOffice reachable through
`LIBREOFFICE_PATH`). LibreOffice is the fast preview renderer; Microsoft Word
and PowerPoint remain the final compatibility target. No other MCP host is a
design target. English briefs first; Italian follows.

"10x" operationalised. Both baselines are measured and recorded in
`packages/design-evals/baselines/`: **cold** on 2026-09-04 and **assisted**
with skill 3.2.0 on 2026-09-05, each 40 briefs on the development corpus,
server 2.0.0, `claude-sonnet-5`, judged on renders, no failures and nothing
contaminated. The original estimates are kept because where they were wrong is
itself a finding.

| Metric (eval harness, §5A, on the brief corpus)                                        | Est. | **Cold (2.0.0)**                   | **Assisted (skill 3.2.0)** | Target |
| -------------------------------------------------------------------------------------- | ---- | ---------------------------------- | -------------------------- | ------ |
| Outputs rated _excellent_ (rubric level ≥ 4, judged on renders)                        | ~5%  | **25%** (10/40)                    | **40%** (16/40)            | ≥ 50%  |
| Outputs with any rendered integrity defect (overflow, clip, overlap, placeholder text) | ~60% | **not yet measurable** — see below | **not yet measurable**     | ≤ 5%   |
| Median rubric score                                                                    | ~4   | **3** (of 5)                       | **3** (of 5)               | ≥ 8    |
| Median author iterations to "done"                                                     | 4–6  | **1**                              | **1.5**                    | ≤ 2    |
| Outputs the judge would ship to a client without human touch-up                        | ~5%  | **20%** (8/40)                     | **22.5%** (9/40)           | ≥ 50%  |

**The assisted baseline is the important one, and reading it took three
instruments, two of which were wrong.**

The skill was to be "today's ceiling", the level the product should reach. On
the shipping metric it scores 22.5% against the product's 20%, and paired, only
2 of 40 briefs ship in both conditions while 6 are lost and 7 gained. That
looked like a null result. It is not a result at all: the judge was measured
against itself on the same 39 documents a day later and moved 8 shippable to
12, every change in the same direction and none coming back
(`baselines/2026-09-05-rejudge-cold-documents.json`). The difference being
claimed is one document. The instrument's zero moves by four.

**Compared pairwise, the skill wins and never loses.** Each brief's two
documents were shown to the judge twice, once in each order, counting only the
briefs whose verdict survives the swap
(`baselines/2026-09-05-pairwise-cold-vs-assisted.json`):

|                                 | briefs |
| ------------------------------- | ------ |
| assisted better, in both orders | **6**  |
| cold better, in both orders     | **0**  |
| the two orders disagreed        | 30     |
| not compared                    | 4      |

Six against nil is p = 0.031 on a sign test, and eleven of those twelve showings
called the margin "clear". The thirty disagreements are not ties: they are pairs
whose difference is smaller than the judge's own pull towards whatever it saw
second, which this run measured at 64% and the single-order run before it at
68%. A first pairwise attempt that showed each pair once returned 25–13 for the
skill and was mostly seating — kept as
`baselines/2026-09-05-pairwise-single-order-SUPERSEDED.json`.

So the honest statement is narrower than either draft of this section. **Prose
guidance does produce better documents.** The effect is real, one-directional,
and invisible to the metric this table leads with — detectable on about one
brief in six, and below the resolution of a binary ship verdict on the rest.
The craft measures agree: rubric level improved on 19 briefs and worsened on 6,
genericness improved on 18 and worsened on 7, off-palette findings roughly
halved, 611 to 328.

That does not weaken the programme's first principle, it sharpens it. Taste as
data is not needed because prose fails; it is needed because prose buys an
improvement this small, on 82 KB and one document in six, while a rule or a
blueprint applies every time. And **≥ 50% remains territory neither the product
nor its best prose guidance has reached** — with the caveat, now measured, that
the metric guarding that number cannot currently resolve differences of the size
this programme will produce. Fixing that is #321, and it is a gate on reading
any phase result, not on starting one.

The skill also introduces one regression the Phase 0 rules caught:
`W_QUALITY_TEXT_TIGHT` goes from 17 findings across 5 documents to **110 across
7**, about sixteen per affected document. Its density guidance packs text into
boxes that barely hold it.

**The integrity row cannot be filled yet, and must not be read as 0%.** The
static rules found no integrity defect in either set, but that row asks about
_rendered_ defects and the rendered pass (§5E, #344) does not exist; §2 finding
7 measures the static estimator's ceiling at roughly half of real spills. A 0%
here would mean "nothing was looked for with the instrument that finds these",
not "there are none". It is filled when #344 lands.

**Before the shipping metric gates a phase, its variance needs measuring.** Two
of forty documents ship in both conditions while thirteen flip. That is
consistent with most documents sitting near the boundary, but also with
run-to-run variance large enough to swamp a phase delta. §5A already prescribes
three runs per brief on the sealed corpus for this reason; a `--repeat 3` pass
over a handful of development briefs would quantify it for a couple of hours of
wall time.

The judges' verdicts agree on what holds documents back, and it is not
integrity. Across the 25 briefs that ship in neither condition, the recurring
findings are **generic containers** ("a competent stock consulting frame that
would look identical for any other decision deck", "neutral to the point of
anonymous") and **charts and tables without units, sources or takeaways** —
`table` appears 117 times in those verdicts, `chart` 53, `unit` 27, `source` 22. Content is not the problem: the same verdicts praise titles that state
conclusions. This maps onto Phase 1 and Phase 2 for the containers, and onto
#346 and #340 for the chart and table failures.

The last row is the practical definition: the median cold-start output must be
something Paolo would send to a client as is. Failed runs remain in every
metric's denominator and count as not shippable — this baseline had none, and
one run that reached a company MCP server was re-run under `strictMcpConfig`
before the set was recorded.

## 2. Diagnosis

What an agent gets from server 2.0.0 today, and why output lands on generic:

| #   | Finding                                         | Evidence                                                                                                                                                                                                                                                   | Effect                                                                                                                                                        |
| --- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Starters are spikes                             | 4 starters, a few hundred bytes; the pptx ones select `theme: default`                                                                                                                                                                                     | First move copies the 2007 Office look: `#4472C4`, Arial, 36pt bold centred title, italic subtitle                                                            |
| 2   | PPTX built-in themes are Office palettes        | `default` / `dark` / `minimal`: 10 colours, 2 fonts, 7 text presets, one table default; no spacing, no scale, no chrome, no motifs                                                                                                                         | A theme swap changes colours, not design                                                                                                                      |
| 3   | The designed templates are invisible to MCP     | 8 reference templates + `vermilion-annual-report` live in `packages/jto/src/client/public/templates` (86–673 KB each); the skill fetches them from the hosted playground over the network; no manifests                                                    | The cold path never sees a designed document; the assisted path depends on network and guesses on fit                                                         |
| 4   | Reference templates are coordinate compositions | 203–421 absolutely positioned nodes per deck, 1–4 templates each, grid unused                                                                                                                                                                              | Not reusable as layouts, too large to copy; agents imitate the approach by hand-placing boxes                                                                 |
| 5   | No layout abstraction                           | #220–#224 designed, not built                                                                                                                                                                                                                              | Every slide is authored in inches; overflow, misalignment and uneven rhythm follow                                                                            |
| 6   | Quality rules stop at level 2                   | 5 pptx + 6 docx rules, all integrity / legibility                                                                                                                                                                                                          | Nothing checks coherence (alignment, scale, palette, chrome), information design (chart type, table alignment) or content (placeholder text, untitled slides) |
| 7   | Half of overflows escape the static estimator   | ground-truth harness ceiling ≈ 50% strict detection; rendered pass not built                                                                                                                                                                               | Defects reach the user unless the agent eyeballs every page                                                                                                   |
| 8   | Taste lives in prose outside the product        | skill 3.1.0: ~40 KB of taste files, partly stale (theme README names docx themes that do not exist; px/opacity rules with no schema mapping); playground prompts: 38 KB, the docx prompt names components (`Report`, `Heading`) the schema does not define | Advice drifts from the schema release after release; nothing enforces it                                                                                      |
| 9   | Server instructions carry no design workflow    | `SERVER_INSTRUCTIONS`: discover, patch, validate, preview                                                                                                                                                                                                  | The agent decides look, structure and layout alone at every node and picks the "safe" generic option each time                                                |
| 10  | Nothing measures outcomes                       | calibration suite (false positives only) + ground-truth harness (overflow estimator only); 2 briefs in the skill evals                                                                                                                                     | Quality work is untestable; "better" is opinion                                                                                                               |
| 11  | Content design is unguided                      | one word-budget rule (slide density)                                                                                                                                                                                                                       | Label titles, 8-bullet slides, charts without a takeaway, inconsistent numbers                                                                                |

Root cause in one line: **every design decision is left to the agent, at every
node, in prose.** The fix is structural: move the decisions into data the
product owns (themes, blocks, layouts, blueprints), reduce the agent's job to
selection and content, check the rest mechanically, and measure the result.

## 3. Principles

1. **Taste as data, not prose.** Scales, spacing, palettes, chrome, block and
   layout recipes, blueprints and rubrics are versioned data inside the
   packages; every piece of guidance text is generated from that data so it
   cannot drift.
2. **Fill, don't draw.** The default path is blueprint → theme → scaffold →
   fill slots. Coordinates remain the escape hatch, fully supported.
3. **JSON stays authoritative and inspectable.** Block and layout compilation
   emits ordinary validated low-level JSON with source maps; no hidden state
   (#220).
4. **Guarantee what can be measured, advise on the rest.** Rendered analysis
   becomes a first-class evidence source; vision review is `evaluative` and
   never a gate.
5. **One house style, few alternates.** A consulting house theme is the
   default in both formats; two alternates exist so the output is not
   uniform; the judge penalises sameness anyway.
6. **Taste in the server, workflow in the skill.** The skill says when and in
   which order to call the tools; everything about how a document should look
   lives in the server as data and resources.
7. **Measured, not gated.** The harness produces the baseline and an
   end-of-phase scorecard; phases are accepted on the scorecard delta, PRs are
   not blocked by it.
8. **Theme paints; profile judges.** Themes own visual tokens and rendering
   recipes. Blueprints and design profiles own required structure, density,
   chrome presence and content conventions.

## 4. Target architecture

```text
brief ─▶ agent (Claude in Claude Desktop)
          │  jto_discover: themes · blocks · layouts · blueprints · templates (+ thumbnails)
          │  jto_scaffold(blueprint, theme, brief) ─▶ draft workspace + fill map
          │  jto_workspace_patch: content into slots
          ▼
authored JSON (blocks / semantic slides, optional coordinates)
          │  block + layout compiler (theme tokens + slot content + canvas) ─▶ low-level JSON + source map
          ▼
prepared document ─▶ renderer ─▶ bytes          (docx charts: highcharts via a local/private export server)
          │                        │
          │  static rules L1–L3    │  preview PDF ─▶ rendered facts (geometry, fonts, pages)
          ▼                        ▼
     unified diagnostics ◀── rendered rules (certainty: rendered)
          │
          │  jto_critique: contact sheet + rubric, judged by the host model (evaluative)
          ▼
      jto_generate
```

Ownership follows `taste-system.md`: `quality` keeps contracts and
orchestration; each core owns its facts, rules, themes and its block or layout
compiler; `jto-ops` owns rendered analysis and the eval harness; `mcp-server`
exposes all of it.

## 5. Workstreams

### A. Eval harness and scorecard (first, then at every phase boundary)

Purpose: turn "better" into a number before anything else changes.

- **Development corpus.** 40 committed briefs: 24 docx (weighted to the two
  v1 archetypes, client/PA report and technical report or memo) and 16 pptx;
  consulting tone, varied data density; English first, an Italian subset
  (diacritics, separators, dates) added in Phase 4. These drive phase
  scorecards and may be tuned against. Include the two briefs in the skill's
  `evals.json`.
- **Sealed acceptance corpus.** 20 additional briefs, kept outside the public
  repo and never quoted in prompts, docs, tests or phase scorecards. Only a
  content hash and stratification manifest are committed. They run three times
  each at final acceptance, producing 60 observations; this makes a 5% defect
  rate observable and exposes run variance. Opening this set ends its life as
  held-out; replace it before the next program.
- **Runner.** A headless MCP agent driving the real server over stdio through
  the Claude Agent SDK. Two modes: _cold_ (server only) and _assisted_ (server
  plus skill). Records every tool call, the final JSON, the previews and the
  generated file. It is a development proxy, not assumed equivalent to Claude
  Desktop: Phase 0 and final acceptance include ten paired Desktop runs. If
  ship/no-ship agreement is below 0.8, Desktop results are authoritative.
- **Run manifest.** Every result pins git SHA, package and SDK versions, exact
  model identifier, server instructions and skill hashes, OS, LibreOffice and
  poppler versions, font inventory, export-server version and endpoint class
  (local/private hosted), model parameters, retry counts and all failures.
- **Hard metrics.** Blocking findings at "done"; rendered defects per page
  (§5E); placeholder-text leaks; off-palette and off-scale counts; font
  substitutions; pages or slides versus the blueprint budget; iterations;
  tool calls; tokens; wall time.
- **Judge.** A vision model scores rendered pages against the level 1–5
  rubric (`evaluative`), pairwise against the baseline output and against a
  human-designed reference for the same brief, answers the shipping question
  ("would you send this to a client unchanged?") and applies a genericness
  penalty. Calibrated against Paolo's 40 pairwise comparisons; raw agreement
  and Cohen's kappa with a bootstrap interval are reported with every
  scorecard. Development comparisons may repeat at phase boundaries; the
  sealed acceptance corpus is judged only at final acceptance.
- **Runs.** Manual, on demand, from a single command; no nightly job and no
  PR gate. Phase 0 produces the baseline; each phase closes with a scorecard
  on the same development corpus. Cost per run is reported so the budget stays
  visible.
- **Baseline.** Phase 0 runs server 2.0.0 cold and with skill 3.1.0 under the
  pinned manifest. That is 1x and today's ceiling respectively. A baseline is
  invalidated, rather than silently compared, when a pinned dependency or
  model snapshot cannot be reproduced.

Deliverable: `packages/jto-ops/src/design-evals/` (corpus, runner, judge,
scorecard, one CLI entry point).

### B. Themes, extended into design systems

The concept stays `theme`. The theme schema grows, additively in both formats,
into a complete visual system. Paired pptx and docx variants share tokens so a
deck and its report match. Themes describe how components look; blueprints and
profiles decide which components and conventions are required.

| Layer              | Contents                                                                                                                                                                                                                                                                                                            | Today                         |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| Palette roles      | existing tokens plus `rule`, `textMuted`, `onPrimary`, `surfaceInverse`, an ordered `chart` series list, `positive` / `negative` for deltas                                                                                                                                                                         | 10 pptx slots, 13 docx keys   |
| Type system        | role ladder on top of the presets: `eyebrow`, `display`, `stat`, `quote`, `label`, `footer`, `tableHeader`, `tableCell`, `chartLabel`, `tracker`, `source`; per role: face, weight, size, line spacing, tracking, case, colour role; one scale per canvas (A4, 16:9 standard, 16:9 small) snapped to a 4pt baseline | 7 presets, no scale           |
| Spacing            | base unit, safe area, margins, gutters, block gaps, grid presets per canvas                                                                                                                                                                                                                                         | grid defaults only            |
| Component defaults | every component: table (header treatment, zebra, numeric alignment, padding, notes row), chart (palette, gridlines, label type, source line), image (radius, border, caption), shape (stroke), list, statistic, text-box, divider                                                                                   | pptx table only; docx partial |
| Chrome recipes     | visual recipes for action-title area, section tracker, key-takeaways box, source line and footnotes, confidential footer with `n / N` and date, logo slot, cover treatment; no required-presence semantics                                                                                                          | none                          |
| Motifs             | at most one declared decorative anchor per theme, consumed by blocks and layouts, never applied ad hoc                                                                                                                                                                                                              | none                          |
| Fonts              | the house theme uses SAFE_FONTS only (zero setup on supported Office installations); alternates may register Google or libre families through `fontRegistry` with a declared safe substitute and must hold on substitution                                                                                          | ad hoc per template           |

**House theme: `consulting`** (provisional name). Near-black ink, three greys,
one accent (a deep blue) plus `positive` / `negative`; Arial or Calibri for
headings, Calibri for body, Georgia allowed for docx body, Consolas for code;
visual recipes for sentence-case action titles, tracker top right,
key-takeaways, source lines and a confidential footer with page `n / N` and
date; hairlines, no fills behind body text, no gradients, shadows or 3D;
tabular figures. The consulting profiles, not the theme, require action titles,
section takeaways, sources, footer presence and chart-first structure.

**Alternates**: `vermilion` and `devportal`, today docx-only, get pptx twins
and the extended layers. The current pptx `default`, `dark` and `minimal`
values survive as `office`, `office-dark` and `sage`; the current docx
`minimal` becomes `sage`. `default` (pptx) and `minimal` (docx) resolve to the
house theme. Breaking, so a major bump on `core-docx` and `core-pptx` with a
migration note.

No Wiseair theme ships in the repo. Whether the design-system skill emits a
full extended theme (so brand documents get the same guarantees) is decided
after Phase 1, once the extended schema exists.

Rules read visual values from the resolved theme and required-presence or
content expectations from the selected design profile. A custom theme keeps
the same visual guarantees without accidentally inheriting an archetype.

### C. Blocks and layouts: composition, not coordinates

DOCX first, then pptx, both inside Phase 2.

**DOCX blocks**: new content components compiled to existing primitives,
styled entirely from the theme, and the only way blueprints express
structure. v1 set, sized to the two archetypes:

| Block          | Slots (bounded)                                      | Notes                                                    |
| -------------- | ---------------------------------------------------- | -------------------------------------------------------- |
| cover          | title, subtitle, client, date, confidentiality, logo | theme cover treatment                                    |
| key-takeaways  | items 3–5 of ≤ 25 words                              | opens the document and every major section               |
| section-opener | number, title, tracker label                         | sets the running tracker                                 |
| kpi-row        | metrics 2–4 (value, label, delta, unit)              | tabular figures, signed deltas                           |
| chart-figure   | chart (highcharts), action caption, source           | numbered figure; local/private export by default         |
| data-table     | table, title, notes, source                          | numeric columns right-aligned, notes row, page-safe rows |
| figure         | image, caption, source                               | numbered                                                 |
| callout        | label, body ≤ 60 words                               | hairline rule, no fill                                   |
| footnotes      | automatic                                            | from `source` slots and inline references                |
| running-head   | tracker, confidentiality, page `n / N`, date         | header and footer recipe from the theme                  |

Numbered headings, TOC above a heading threshold, figure and table numbering
and cross-references come from the blueprint and its profile, not from the
agent or theme.

**PPTX layouts**: the slide variant `{ "layout": "<name>", …slots }` beside
the existing template and coordinate variants, implementing #221–#223 with
the consulting conventions. v1 is five layouts:

| Layout       | Slots (bounded)                                                         | Notes                       |
| ------------ | ----------------------------------------------------------------------- | --------------------------- |
| cover        | title, subtitle, client, date, confidentiality, logo                    |                             |
| action-chart | action title ≤ 2 lines, chart, takeaway, source                         | the consulting workhorse    |
| kpi-row      | action title, metrics 2–4                                               |                             |
| two-column   | action title, left (text or bullets ≤ 5), right (chart, table or image) | 1.1 : 1 split               |
| statement    | assertion ≤ 14 words, support ≤ 30 words                                | section or conclusion slide |

Every content layout can render the theme's chrome recipes. The blueprint and
profile decide whether tracker, source line and confidential footer with
`n / N` are required. The remaining layouts (agenda, comparison, process,
quote, image, cards, closing, section) follow in Phase 4 once the five are
measured.

Compiler: pure; theme tokens + slot content + canvas → geometry (pptx) or
flow structure (docx). Overflow policy per slot is data: shrink within scale
steps, then reflow, then reject with a coded issue, never shrink to
unreadable. A source map links every emitted node to its slot pointer; the
compiled form is inspectable through `jto_workspace_inspect` and a
`jto_validate` option. Text-dependent sizing uses the existing width model
now and #211 metrics when they land. Layout geometry starts from the
reference decks (#223) and is re-parameterised on theme tokens.

Every block or layout × theme × canvas × (design fonts | substituted fonts,
alternates only) renders clean through the harness at count, text-length,
numeric-width, asset-ratio and chart-label boundaries: this matrix replaces
the current calibration corpus.

### D. Blueprints, scaffolding, templates through MCP

- **Blueprints**: document archetypes as data: recommended theme, ordered
  blocks or layouts, per-slot content guidance and word budgets, numbering
  and TOC policy, expected length, quality profile. v1: `client-report`
  (client or public-administration report: cover, key takeaways, KPI row,
  chart-first sections, data tables, appendix) and `technical-report`
  (numbered structure, TOC, figures, references, memo variant) for docx;
  `consulting-deck` for pptx over the five layouts. Each blueprint has at
  least two variants (data-heavy and narrative) so two documents from the
  same brief do not look alike.
- **`jto_scaffold`** (new tool): blueprint + theme + brief facts (title,
  client, audience, language, sections or a markdown outline) → a valid
  document with every slot holding an explicit placeholder marker, plus a
  **fill map**: for each slot its JSON pointer, kind, budget and guidance, and
  a workspace handle + revision ready for patching. The agent fills content
  through workspace patches. From an outline the tool applies the mapping the
  skill documents today. A scaffold is structurally valid but in `draft`
  state: placeholder findings are expected and non-blocking in validation;
  they always block generation. When no markers remain, validation reports it
  generation-ready.
- **Starters** stay as "smallest valid" but stop being the first move and
  adopt the house theme.
- **Templates**: the gallery documents ship inside the `mcp-server` npm
  package as resources (`jto://templates/<name>`, plus a low-DPI thumbnail
  per page) with generated manifests (format, theme, archetype, pages, slot
  inventory, when to use), validated by `validate:assets`. No network at
  discovery time.

### E. Quality rules: levels 3–4, and rendered certainty

Static rules over the prepared model, using the existing categories and
certainty axis, with RFC 6902 fixes wherever the repair is deterministic. In
priority order:

| Rule (both formats unless noted)                                                                                                    | Category                                       | Certainty     | Fix                     |
| ----------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- | ------------- | ----------------------- |
| placeholder text: lorem, "Your …", `[…]`, scaffold markers                                                                          | integrity                                      | deterministic | none, error at generate |
| overlap of content boxes, z-order aware (pptx)                                                                                      | integrity                                      | deterministic | none                    |
| safe-area breach for non-bleed roles (pptx)                                                                                         | composition                                    | deterministic | clamp                   |
| untitled content slide (pptx); section without heading (docx)                                                                       | hierarchy                                      | deterministic | none                    |
| type scale: size off the theme's scale; more than N sizes per page; same role at different sizes across pages                       | consistency                                    | measured      | snap                    |
| more than 3 font families; raw hex outside the palette                                                                              | brand                                          | deterministic | map to nearest token    |
| alignment consistency: title left edge or baseline drifts across slides (pptx)                                                      | consistency                                    | measured      | none                    |
| chrome consistency: tracker, source line and footer present where the selected profile expects them                                 | consistency                                    | deterministic | none                    |
| action title longer than two lines at its size; more than 5 bullets or 12 words per bullet                                          | hierarchy                                      | estimated     | none                    |
| chart: 3D type, pie over 6 slices, over 4 series, bar axis not from zero, missing series colours, missing units, takeaway or source | information-design                             | deterministic | set palette             |
| table: numeric column not right-aligned, mixed decimals, borders on every cell (info), too many rows per slide or page              | information-design                             | deterministic | align                   |
| image aspect distortion, when the asset is readable                                                                                 | integrity                                      | measured      | set `sizing`            |
| docx measure: body line length outside 45–90 characters                                                                             | legibility                                     | estimated     | none                    |
| docx: heading orphan (h3+ without keep-next), figure without caption or alt text, TOC missing above N headings, empty section       | integrity / accessibility / information-design | deterministic | add prop                |

**Rendered-certainty pass** in `jto-ops`, reusing `extractPdfTextGeometry`
and the preview pipeline: text spill and clipping by real geometry (the other
half of overflows), word-level overlap between boxes, font substitution (PDF
font names against requested families), widows, orphans and headings stranded
at a page bottom (docx), empty pages, tables split badly. Findings map back to
authored pointers through provenance, prepared geometry and normalised text
matching, generalising the harness's sentinel logic. Mapping calibration
covers duplicate strings, ligatures, substitution and fully clipped text;
precision and recall are reported, and unresolved findings remain visible.
Surfaced through a `jto_preview` option and inside `jto_critique`, certainty
`rendered`, advisory by default.

Profiles gain archetype presets matching the blueprints; a blueprint selects
its profile, so `jto_validate` without arguments already judges against the
right bar.

### F. Critique: systematic review in the product

- **Contact sheet**: a `jto_preview` option returns one image tiling all pages
  at low DPI, sized to Claude Desktop's inline image budget. Cross-page
  consistency (rhythm, alignment, chrome) becomes one look instead of N.
- **`jto_critique`** (new tool): an `inspect` action renders, runs the rendered
  pass, builds the contact sheet and returns it together with selected
  full-resolution pages, the archetype rubric (levels 1–5, as data), rendered
  findings and a critique-run id. The host model, Claude in Claude Desktop,
  performs the judgement and turns it into patches. A `record` action accepts
  that run id, document revision, verdict (`ship` / `iterate`) and rationale;
  only then does the server increment the subjective-round count. State is
  keyed by workspace handle and revision, and the third recorded iteration
  returns a stop recommendation. MCP sampling is not used: the protocol
  deprecated it on 2026-07-28 and Claude Desktop never supported it. A
  server-side judge behind an API key stays an option if self-critique proves
  insufficient on the scorecard.

### G. Guidance where the agent is

- `SERVER_INSTRUCTIONS` v2: the design workflow (theme → blueprint → scaffold
  → fill → validate → critique → generate) on one screen, generated in part
  from data (the available themes and blueprints).
- Resources: `jto://themes` (with the extended values), `jto://blocks`,
  `jto://layouts`, `jto://blueprints`, `jto://templates/<name>` with
  thumbnails, `jto://guide/design/<format>`: the concise rules rendered from
  the same data the lint reads (scales, spacing, chart and table rules,
  content rules).
- MCP prompts (`design-brief`, `report-from-notes`, `deck-from-outline`) are
  cheap because Claude Desktop supports them; they are a convenience, not the
  workflow's home.
- Component descriptions: one design note per component, generated from the
  rule data.
- Skill: slimmed to workflow only. Taste files and the supplemental preflight
  retire once §5E and §5F ship; the fetch-from-playground step is replaced by
  `jto_scaffold` and `jto://templates`.
- Playground: unchanged by this program. Its stale docx prompt is a known
  issue outside scope.

### H. Content design

The agent writes the words; the product sets the bar:

- Action titles (a claim with a number or a verb, at most two lines) on every
  content page or slide; label titles only on cover and section openers.
  Info-level rule, archetype-scoped.
- Slot budgets come from blueprints and are enforced by slot constraints.
- Every chart carries a takeaway and a source; every KPI a label and a unit;
  deltas are signed; every table a source or a note.
- Number formatting per language (separators, decimals, units) is consistent
  within a document; dates use one format.
- Diacritics and elision apostrophes are preserved in non-English text;
  tracked uppercase labels may drop them.
- Key takeaways first: the executive summary opens the document; conclusions
  close it with the asks.

## 6. MCP surface changes

| Surface        | Change                                                                                                                           |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `jto_discover` | adds `themes` (extended values), `blocks`, `layouts`, `blueprints`, `templates` with manifests; starters demoted                 |
| `jto_scaffold` | new: blueprint + theme + brief → draft workspace + fill map                                                                      |
| `jto_validate` | reads theme plus profile; returns compiled blocks/layouts optionally; draft markers advise, generation-ready checks require none |
| `jto_preview`  | options for the contact sheet and for rendered findings                                                                          |
| `jto_critique` | new: inspect evidence, then record the host model's verdict against a workspace revision                                         |
| Resources      | `jto://themes`, `jto://blocks`, `jto://layouts`, `jto://blueprints`, `jto://templates/*`, `jto://guide/design/*`                 |
| Prompts        | `design-brief`, `report-from-notes`, `deck-from-outline`                                                                         |
| Instructions   | v2 workflow                                                                                                                      |

Everything is additive except the default-theme change in §5B.

## 7. Acceptance

- The §1 targets are met across the 60 sealed-corpus cold observations. The
  headless proxy agrees with ten paired Claude Desktop runs at ≥ 0.8 on the
  ship/no-ship verdict; otherwise Desktop results decide acceptance.
- Every block or layout × theme × canvas × font condition renders with zero
  warnings and zero rendered findings; the matrix is the calibration corpus
  and runs in the converter-dependent CI job.
- Blueprint scaffolds are schema- and semantic-clean, render clean with
  deliberate markers, and report only the expected non-blocking draft-marker
  findings before content is added. Generation always refuses remaining
  markers.
- No output from the harness contains placeholder text, off-palette colours
  or off-scale sizes.
- Judge/human Cohen's kappa ≥ 0.7 on 40 pairwise comparisons; the sameness
  score across themes stays below a threshold fixed before Phase 1.
- At the end of Phase 2 and again at final acceptance, ten harness outputs
  opened in Word and PowerPoint show no divergence from the LibreOffice
  preview that changes a verdict. Any such divergence blocks the phase; an
  Office-based render step becomes required work, not a later recommendation.
- Docs: a gallery page per theme and per block or layout with generated
  previews; the guide chapters on design regenerate from data.

## 8. Phasing

Capacity: full-time, one engineer working with coding agents.

| Phase                         | Weeks   | Deliverables                                                                                                                                                                                                                                                                                                                                  | Depends on |
| ----------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| 0 — measure and quick wins    | 2       | development harness and baseline; sealed-corpus manifest; paired Desktop calibration; template manifests bundled; contact sheet; instructions v2; rules: placeholder text, overlap, font count, off-palette; Claude Desktop setup notes (`LIBREOFFICE_PATH`, output and workspace dirs); verify local/private export-server palette and fonts | none       |
| 1 — themes                    | 4–6     | extended theme schema in both formats; `consulting` house theme plus `vermilion` and `devportal` twins; aliases and default switch (major); component defaults; `jto://themes`; docs gallery; scorecard                                                                                                                                       | 0          |
| 2 — blocks, layouts, scaffold | ~8      | docx blocks and two docx blueprints, then five pptx layouts and `consulting-deck`; block/layout compilers with source maps; profile-aware consistency rules; `jto_scaffold`; rendered-certainty pass; matrix calibration; blocking Office check on ten outputs; scorecard                                                                     | 1          |
| 3 — critique and rules        | 4       | `jto_critique`; remaining level 3–4 rules; archetype profiles; prompts; skill slimmed; scorecard                                                                                                                                                                                                                                              | 2          |
| 4 — converge                  | ongoing | remaining pptx layouts; Italian brief subset; design-system skill decision; #211 metrics into the compilers; #224 editor completion; tune by scorecard                                                                                                                                                                                        | 3          |

Phase 0 and the harness come first so that every later phase is accepted on
its scorecard delta rather than by inspection, even though no PR is gated.

### Execution plan — revised 2026-09-05

This sequence supersedes the phase-by-phase ordering above and the scheduling
language elsewhere in this document; the architecture and the final scope
stand. It is recorded in full on the epic (#319) and summarised here so the
spec and the tracker say the same thing.

**Shipped.** #320–#327 (Phase 0), #346 (chart and table information-design
rules) and #328 (the shared palette/type/spacing foundation; chrome and motif
_consumers_ split to #361). The Phase 1 schema decisions are settled in
`phase-1-theme-schema-map.md`. The branch carrying this revision delivers
#354 (Highcharts inherits the document typography), the DOCX portion of #329
(`consulting`, opt-in) and the compiler-and-slot portion of #334
(`key-takeaways`); each closes on its own acceptance, not on this note.

**Next milestone: a complete client-report workflow (#362).** Given a real
brief and data, Claude Desktop scaffolds, fills, validates, previews, repairs
and delivers a Word report, and the user reviews the argument instead of the
formatting. Its required portions, in order:

1. #361 report chrome and #334 block compiler with `key-takeaways`, then the
   report-required blocks of #335–#337 (structure and running head, numeric
   table, chart with units, takeaway and source).
2. #338 one client-report blueprint and profile; #339 scaffold, fill map,
   marker blocking and discovery.
3. #332 report-specific consistency rules and #333 generated guidance.
4. #344 report-relevant rendered detection prototyped early, with #343
   boundary fixtures, through the existing preview/contact-sheet/patch flow;
   #345 is not a prerequisite.
5. #360 matched development evidence alongside, without blocking the
   implementation: 6–8 varied briefs, three runs each, actual Claude Desktop
   delivery, outputs inspected in Word, a proceed/revise decision recorded
   on #362.

**After the checkpoint.** Technical-report variants, alternate themes (#330)
and PPTX layouts/blueprint (#340–#342). Both-format house-theme coverage
precedes the default switch (#331), which ships as a major with distinct
legacy aliases and migration notes and keeps the corpus pinned. Formal
critique (#345), the remaining rules and prompts (#347–#348) and the full
matrix (#343) remain required for final acceptance.

**Measurement.** The rubric is 1–5: excellent is ≥ 4 and the final median
target ≥ 4/5, replacing the stale ≥ 8. The report checkpoint is not
statistical acceptance; the sealed corpus stays untouched until the final
run, with uncertainty grouped by brief and DOCX and PPTX reported separately.
Broad issues stay open until every acceptance criterion passes; a partially
delivered prerequisite neither blocks report integration nor closes early.

## 9. Risks

| Risk                                                | Mitigation                                                                                                                                                     |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sameness: every document looks like the house theme | two alternates with different structure and motif; blueprint variants; judge genericness penalty; coordinates remain available                                 |
| Export server confidentiality and availability      | local/private server by default; hosted transmission requires explicit opt-in; native chart and `visual` fallbacks documented; failures count as non-shippable |
| Judge cost and drift                                | manual runs with reported cost; sealed final corpus; development-only phase calibration; pinned run manifests                                                  |
| LibreOffice is not Office                           | blocking ten-output Office checks at Phase 2 and final acceptance; any verdict-changing divergence requires an Office render step                              |
| Font licensing                                      | house theme on SAFE_FONTS; alternates on libre or Google fonts with declared substitutes; nothing restrictively licensed (PR #293)                             |
| Breaking defaults                                   | aliases, major bump, migration note                                                                                                                            |
| Contact sheet exceeds the inline image budget       | low DPI, page-range paging, path delivery as today                                                                                                             |
| Scope                                               | docx blocks before pptx layouts; five layouts before fourteen; every phase closes with a scorecard                                                             |

## 10. Non-goals

- Host-neutral parity: no other MCP host is a design target.
- A Wiseair theme or any brand asset in the repo; brand stays with the
  design-system skill and, later, #240.
- Playground changes.
- Nightly evaluation jobs or PR gates on the scorecard.
- Importing existing Office files (#234).
- A single opaque quality score inside product diagnostics; the scorecard is
  an evaluation instrument.
- Factual verification or prose rewriting.
- Hiding compiled geometry from the author.

## 11. Decision record (2026-09-02; revised 2026-09-03)

| #   | Decision                                                                                                      |
| --- | ------------------------------------------------------------------------------------------------------------- |
| 1   | Target user: Paolo and Wiseair; surface: Claude Desktop only                                                  |
| 2   | 10x = the four scorecard targets plus "shippable without human touch-up"                                      |
| 3   | House visual aesthetic: consulting; archetype requirements stay in profiles                                   |
| 4   | Harness and baseline before any taste change                                                                  |
| 5   | docx before pptx                                                                                              |
| 6   | Fill, don't draw, built incrementally and measured                                                            |
| 7   | Capacity: full-time                                                                                           |
| 8   | Backlog: #216–#224 and #211 folded in; #212, #225, #230, #235 and #240 deferred explicitly                    |
| 9   | Content: slot constraints plus info-level rules, never warnings on free text                                  |
| 10  | One house theme plus two alternates; each blueprint has two structural variants                               |
| 11  | English first, Italian in Phase 4                                                                             |
| 12  | LibreOffice as preview ground truth; Office is the final compatibility gate at Phase 2 and program acceptance |
| 13  | Scope: new documents and editing of existing jto JSON                                                         |
| 14  | Brand only through the design-system skill; no Wiseair theme in the repo                                      |
| 15  | Claude Desktop is the only surface that must work                                                             |
| 16  | v1 docx archetypes: client/PA report, technical report or memo                                                |
| 17  | Critique uses inspect/record against an exact workspace revision; no MCP sampling                             |
| 18  | Taste as data in the server; skill reduced to workflow                                                        |
| 19  | House theme on SAFE_FONTS only                                                                                |
| 20  | Defaults switch to the house theme in both formats; old values under aliases; major bump                      |
| 21  | docx charts through `highcharts`; local/private export by default, hosted only with explicit opt-in           |
| 22  | Templates and thumbnails bundled in the npm package                                                           |
| 23  | Judge calibration: 40 development-corpus comparisons by Paolo; sealed corpus judged once                      |
| 24  | Harness runs manually, on demand                                                                              |
| 25  | Concept name: `theme`, extended; no new "look" concept                                                        |
| 26  | Versioning implicit through package versions; no version fields in documents                                  |
| 27  | Playground unchanged                                                                                          |
| 28  | Phase 2: docx blocks, then five pptx layouts, same phase                                                      |
| 29  | Themes style consulting chrome; blueprints/profiles decide required presence and content                      |
| 30  | No PR gate on the scorecard                                                                                   |
| 31  | Design-system skill emitting an extended theme: decided after Phase 1                                         |

Deferred decisions: the design-system skill theme (after Phase 1); a
server-side API judge (only if self-critique underperforms on the scorecard);
the Italian brief subset timing (Phase 4); versioned brand packs (#240).
