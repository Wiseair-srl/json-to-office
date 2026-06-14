---
name: json-to-office
description: Produce pixel-perfect Microsoft Word (.docx) and PowerPoint (.pptx) documents from natural-language briefs by authoring json-to-office JSON, then validating and visually iterating via a render → screenshot → refine loop. Trigger whenever the user asks for a deck, slides, presentation, pitch, report, brief, Word doc, .docx, .pptx, or mentions json-to-office / jto. Owns curated taste rules (typography, slide composition, charts, tables) distilled from a wide design corpus, plus a library of starting templates so the model never writes from scratch.
license: MIT
---

# json-to-office

You are authoring **DOCX or PPTX as serializable JSON** with the `@json-to-office` libraries, then rendering and visually iterating until the result is pixel-perfect. This skill ships with curated taste rules, ready-to-fill templates, JSON schemas, and Python orchestration scripts that drive the render-and-iterate loop.

## When to fire

Fire on any of:

- Explicit: user mentions `.docx`, `.pptx`, `json-to-office`, `jto`, `jto-cli`, `pptxgenjs`, `docx-lib`, "json-to-office JSON".
- Document briefs: "deck", "slides", "pitch", "presentation", "keynote", "powerpoint", "report", "brief", "white paper", "Word doc", "executive summary", "one-pager", "invoice", "proposal", "memo", "article".
- Editing requests on `*.docx.json` or `*.pptx.json` files in the user's repo.

If a brand or design-system skill is also active in the session, **defer to it** for theme tokens — colors, fonts, spacing scale. This skill provides the document structure; the brand skill provides the look.

## Workflow (follow in order)

### 1. Probe the environment

Run once per session:

```bash
python3 <skill>/scripts/bootstrap.py
```

It writes `<skill>/.skill-out/caps.json` with the runtime's capabilities. Two paths from here:

- **Full loop**: `can_screenshot: true` — you have Node, LibreOffice, pdftoppm. Validate → render → Read PNGs → iterate.
- **Validate-only**: `can_screenshot: false` — render the office file but skip the visual loop. Warn the user that pixel-perfection isn't verifiable.

> **Rendering services (charts & visuals).** `highcharts` charts and docx `visual` graphics render out-of-process. `render_preview.py` auto-wires them to the hosted instance `https://jto-render-server.onrender.com` — always for charts (no local fallback exists), and for visuals only when local LibreOffice + `pdftoppm` aren't found (otherwise visuals rasterize locally, which is faster and keeps content on-machine). The first call after the instance is idle can be slow (cold start), and the relevant content is sent to that service when used. Point at your own server, or opt out, via the `HIGHCHARTS_SERVER_URL` / `JTO_PPTX_RASTERIZER_URL` env vars (a value you set always wins).

### 2. Pick a template, don't author from scratch

The first move is **always** to pick a starting template. Read template manifests:

```bash
ls <skill>/assets/templates/pptx/   # 5 PPTX templates
ls <skill>/assets/templates/docx/   # 4 DOCX templates
cat <skill>/assets/templates/pptx/<name>.manifest.json
```

Manifests tell you when each template is the right pick. Match the user's brief to the closest one. **Never start from `{}`** — the cold-start authoring quality is dramatically worse than slot-filling.

Copy the template to a working path:

```bash
python3 <skill>/scripts/new_from_template.py pptx pricing decks/our-pricing.pptx.json
```

### 2.5. Working from a markdown outline (PPTX)

When the user provides a markdown outline as the source for a deck, translate it like this:

| Markdown               | Slide type                                                                      |
| ---------------------- | ------------------------------------------------------------------------------- |
| `# Top-level heading`  | Section divider (one per major chapter, numbered "01", "02")                    |
| `## Heading`           | One content slide each. Don't merge multiple `##` into one slide.               |
| `### Heading`          | Sub-heading within a content slide, or its own slide if the body is substantial |
| Bullet list, 3-5 items | Body of one slide                                                               |
| Bullet list, 6+ items  | Split across multiple slides — max 5-6 bullets per slide                        |
| Markdown table         | Table slide                                                                     |
| `---`                  | Forced slide break                                                              |

Default: **one `##` heading = one slide**. If a section has too much content, split and repeat the section label in the header.

For 15+ slide decks:

- Always define COVER, SECTION_DIVIDER, CONTENT, CLOSING templates.
- Add 2-4 variety templates from {TWO_COLUMN, METRICS, CHART, QUOTE, IMAGE_FULL} based on outline content.
- **Rotation rule:** don't reuse the same template >3 slides in a row. Numbered lists → METRICS; side-by-side items → TWO_COLUMN; data references → CHART.

Content expansion: bullets become slide text (≤12 words each); headings without body need 3-4 generated bullets; numbers and stats get promoted to METRICS templates; speaker notes get the verbatim/expanded markdown text.

Chunking for big decks: write theme + templates + skeleton (zero slides) first, validate, then add slides in batches of 5-8, reviewing for template variety and section numbering at each batch boundary.

### 3. Read taste rules before editing

Read these files **before** modifying any JSON values that affect look:

- `<skill>/assets/taste/gotchas.md` — always (every silent failure mode in one list)
- `<skill>/assets/taste/typography.md` — always
- `<skill>/assets/taste/slide-composition.md` — if PPTX
- `<skill>/assets/taste/layout-system.md` — if PPTX (4pt baseline, type scale, grid presets, lineSpacing rules, prop confusions)
- `<skill>/assets/taste/tables.md` — if your document has tables
- `<skill>/assets/taste/chart-design.md` — if charts

For props that aren't covered by templates, reach for the curated cheat-sheet for the format:

- DOCX: `<skill>/assets/references/docx-cheatsheet.md`
- PPTX: `<skill>/assets/references/pptx-cheatsheet.md`

Only **grep** the schemas — never read them whole; they are megabytes:

- DOCX: `<skill>/assets/schemas/document.schema.json`
- PPTX: `<skill>/assets/schemas/presentation.schema.json`
- Theme overrides: `<skill>/assets/schemas/theme.schema.json`

### 3.5. Establish design direction (when authoring a new theme)

If you are about to create a new theme — or generate a document whose theme is unspecified, or the user asked for "designed/polished/professional" output — read `<skill>/assets/taste/design-direction.md` and produce the 6-line brief it specifies. Show the brief to the user before authoring; commit to it for the whole document. Skip this step when the user provided a theme, a brand kit, or a brand/design-system skill is active.

### 4. Read the theme guide

`<skill>/assets/themes/README.md` lists the built-in themes from `@json-to-office/core-docx` and `@json-to-office/core-pptx`, with guidance on when to pick each. Reference a theme **by name** (`"theme": "minimal"`) — don't hand-author one. If you need a one-off accent override, use `themeOverrides` at the document root.

### 5. Author the JSON

Slot user-provided content into the template. Hard rules:

- **Use theme tokens, not hex colors.** `"color": "primary"` not `"color": "#4472C4"`. A theme swap must work.
- **Use the grid for PPTX.** Slides declare `props.grid: { columns: 12, rows: 6 }`. Components position via `grid: { column, row, columnSpan, rowSpan }`. Don't pixel-place.
- **One idea per slide.** If a slide has >40 words of body text, split it.
- **Tabular figures on numerics.** Tables, stats, chart axes — never let numbers slide into italic serif.
- **Don't invent component names.** If the schema doesn't list it, it doesn't exist. Use what's there (`heading`, `paragraph`, `columns`, `table`, `list`, `statistic`, `text-box`, `toc`, `image`, `visual`, `highcharts` for DOCX; `text`, `chart`, `table`, `shape`, `image`, `highcharts` for PPTX).

### 6. Validate

```bash
python3 <skill>/scripts/validate.py decks/our-pricing.pptx.json
```

Fix any errors before rendering. If the validator warns about a known false-negative on the root component (`docx` / `pptx`), it's a library bug — the script downgrades it to a warning automatically.

### 6.5. Pre-flight (PPTX)

```bash
python3 <skill>/scripts/preflight.py decks/our-pricing.pptx.json
```

Walks every text node, estimates rendered height vs. declared bounding box, and reports per-node `OVERFLOW`, `TIGHT`, or `OK`. **Fix every OVERFLOW** before rendering — they will produce visible defects. `TIGHT` flags are fragile fits inside an 8pt safety buffer; fix them when feasible or accept the risk consciously.

The render step (next) runs this automatically and exits non-zero on OVERFLOW. Skip explicitly only when you've already triaged the report.

### 7. Render and visually inspect

```bash
python3 <skill>/scripts/render_preview.py decks/our-pricing.pptx.json
```

Output:

```
OFFICE_FILE=/path/to/.skill-out/our-pricing/out.pptx
PNG=/path/to/.skill-out/our-pricing/page-01.png
PNG=/path/to/.skill-out/our-pricing/page-02.png
...
```

**You MUST then Read each PNG.** They are real images; you can see them. Inspect for:

- Text overflow (wraps awkwardly, runs off edge)
- Grid misalignment (columns don't line up across slides)
- Hierarchy mistakes (H1 and H2 look identical)
- Contrast issues (light text on light background, dark on dark)
- Density problems (one slide cramped, the next half-empty)
- Bad measure (lines too long or chopped)
- Chart sins (default colors, jagged axes, illegible labels)

If `render_preview.py` prints `VALIDATE_ONLY` first, you're in the degraded path — skip the visual inspection, warn the user.

### 8. Iterate

If anything looks wrong, edit the JSON and re-run `render_preview.py`. **Max 3 iterations** — past that, you're overfitting noise. If issues remain after 3 rounds, ship and tell the user what's still off.

### 9. Report

Tell the user:

- The final `OFFICE_FILE=` path
- 1-2 sentences on what you did (template used, theme chosen, anything notable)
- If `VALIDATE_ONLY` mode was used: a one-line note that pixel-perfection couldn't be verified in this environment

## Schema cheat-sheet

DOCX root: `{ "name": "docx", "props": { "theme": "minimal", ... }, "children": [...] }`

DOCX components (`name` values): `section`, `heading`, `paragraph`, `columns`, `list`, `table`, `statistic`, `text-box`, `toc`, `image`, `visual`, `highcharts`. `visual` embeds a free-canvas pptx graphic (infographic / diagram / hero art) as a rasterized PNG — see the cheat-sheet.

PPTX root: `{ "name": "pptx", "props": { "theme": "default", "grid": { "columns": 12, "rows": 6 }, ... }, "children": [...] }`

PPTX components inside `slide`: `text`, `chart`, `table`, `shape`, `image`, `highcharts`. Each takes a `grid` prop for placement.

`props.theme` is a theme name from `@json-to-office/core-docx`'s or `@json-to-office/core-pptx`'s built-ins. See `assets/themes/README.md`.

## Anti-patterns (don't ship these)

- Hardcoded hex colors in component props — defeats theming.
- More than 3 typefaces in one document.
- Italic numbers (serif italic on stat figures or table cells).
- Body text walls on slides (>40 words).
- Three-column layouts on slides (use two; slides aren't pages).
- Charts using default `pptxgenjs` colors instead of theme accents.
- Centered numeric table columns (impossible to compare digits).
- Borders on every table cell (Excel 2003 vibe).
- Skipping the render → screenshot → Read loop because "the JSON looks fine". The whole point is visual verification.
- Authoring from `{}` instead of starting from a template.

## When the user is iterating on an existing file

If the user gives you `report.docx.json` and asks for edits: skip step 2 (no template needed), read schemas + taste + their file, propose edits, run validate + render, Read PNGs, iterate.

## Library reference

This skill drives the `@json-to-office` family:

- `@json-to-office/core-docx` — DOCX rendering engine
- `@json-to-office/core-pptx` — PPTX rendering engine
- `@json-to-office/jto-cli` — CLI used by the scripts in this skill
- `@json-to-office/json-to-docx`, `@json-to-office/json-to-pptx` — programmatic API wrappers

Online playground (when working interactively, optional): https://docx.json-to-office.com · https://pptx.json-to-office.com
