# Layout system

The numerical contract for every PPTX deck. While `slide-composition.md` and `typography.md` answer _what should this look like_, this file answers _where exactly does each element go, and how big is it_.

Every value here is computed, not guessed. Deviate only with explicit reason.

## The 4pt baseline rule

**Every numeric vertical-spacing value in PPTX must be a multiple of 4pt.** This includes `lineSpacing`, `paraSpaceBefore`, `paraSpaceAfter`, table cell `margin`, shape internal padding, and the _delta between any two y-positions_ on the same slide.

Why 4pt: it is the smallest divisor of the type scale below that produces visually clean alignment without being so loose that it limits design. 8pt is also acceptable for major spacing between blocks; reserve 4pt for fine adjustments inside a block.

Quick check: if you write `lineSpacing: 27` or `paraSpaceAfter: 11`, stop. Round to the nearest 4 (28 and 12).

For absolute `y` positioning in inches, 4pt = 0.0556 in. For percentage `y`, the snap value depends on slide height:

| Slide height          | 4pt as % | Snap to |
| --------------------- | -------- | ------- |
| 5.625" (16:9 small)   | 0.99%    | 1.0%    |
| 7.5" (16:9 standard)  | 0.74%    | 0.75%   |
| 9.375" (4:5 vertical) | 0.59%    | 0.60%   |

In practice, prefer absolute inches: `y = round(target_pt / 72 * 1000) / 1000`.

## Spacing scale

Use only these values for any spacing decision (gutters, padding, gap between blocks, spaceBefore/After). No arbitrary numbers.

| Token | Value (pt) | Use case                                  |
| ----- | ---------- | ----------------------------------------- |
| 2xs   | 4          | Inside-block fine adjustments             |
| xs    | 8          | Tight grouping (label above heading)      |
| sm    | 12         | Default paraSpaceAfter for body           |
| md    | 16         | Default paraSpaceAfter for headings       |
| lg    | 24         | Between major blocks within a placeholder |
| xl    | 32         | Section break inside a slide              |
| 2xl   | 48         | Decorative breathing room                 |
| 3xl   | 64         | Cover-slide title-to-subtitle gap         |

For inch-based values (margin, gutter):

| Token | Value (in) | Use case                                           |
| ----- | ---------- | -------------------------------------------------- |
| xs    | 0.08       | Gutter for dense 24-col grids                      |
| sm    | 0.12       | Standard gutter for 12-col grids on small canvases |
| md    | 0.16       | Standard gutter for 12-col grids on 16:9           |
| lg    | 0.4        | Slide margin on small canvases                     |
| xl    | 0.55       | Slide margin on 16:9 standard (matches default)    |
| 2xl   | 0.7        | Generous slide margin for editorial layouts        |

## Type scale

A curated typographic scale, anchored to a body size and snapped to the 4pt baseline.

### Base body size by format

| Format                    | Body base | Rationale                                       |
| ------------------------- | --------- | ----------------------------------------------- |
| 16:9 (10" or 13.333")     | 16 pt     | Reading distance ~3m projection or ~50cm screen |
| 1:1 carousel (7.5")       | 18 pt     | Mobile-first, closer reading distance           |
| 4:5 vertical (7.5×9.375") | 18 pt     | Mobile-first                                    |
| 9:16 story (4.5×8")       | 20 pt     | Phone, even closer                              |

### Full scale (body=16)

| Role    | fontSize | lineSpacing | paraSpaceBefore | paraSpaceAfter |
| ------- | -------- | ----------- | --------------- | -------------- |
| micro   | 10       | 12          | 0               | 4              |
| caption | 12       | 16          | 0               | 4              |
| body    | 16       | 20          | 0               | 12             |
| h3      | 20       | 24          | 16              | 8              |
| h2      | 28       | 36          | 24              | 12             |
| h1      | 40       | 48          | 32              | 16             |
| display | 56       | 64          | 0               | 24             |
| hero    | 80       | 92          | 0               | 32             |

### Full scale (body=18)

| Role    | fontSize | lineSpacing | paraSpaceBefore | paraSpaceAfter |
| ------- | -------- | ----------- | --------------- | -------------- |
| micro   | 11       | 12          | 0               | 4              |
| caption | 13       | 16          | 0               | 4              |
| body    | 18       | 24          | 0               | 12             |
| h3      | 22       | 28          | 16              | 8              |
| h2      | 30       | 40          | 24              | 12             |
| h1      | 44       | 52          | 32              | 16             |
| display | 60       | 68          | 0               | 24             |
| hero    | 88       | 100         | 0               | 32             |

The lineSpacing-to-fontSize ratio sits between 1.05 and 1.30 across the scale: tighter at the extremes (display, hero), looser at body for reading comfort. All values are multiples of 4.

### Hero and display: character ceiling

Hero and display sizes have a per-line character cap. Exceeding it forces a wrap that almost always overflows even with generous height.

| Format | Hero (per-line cap) | Display (per-line cap) | h1 (per-line cap) |
| ------ | ------------------- | ---------------------- | ----------------- |
| 16:9   | ≤22 chars at 80pt   | ≤32 chars at 56pt      | ≤45 chars at 40pt |
| 1:1    | ≤14 chars at 88pt   | ≤22 chars at 60pt      | ≤30 chars at 44pt |
| 4:5    | ≤14 chars at 88pt   | ≤22 chars at 60pt      | ≤30 chars at 44pt |

If a title exceeds the cap, **scale down to the next step before rendering**. `fontSize: 80 → 72` is acceptable as long as `lineSpacing: 92 → 84` moves with it. Keep them in lockstep.

## Slide canvas — set it explicitly, every time

**The renderer's default is 4:3 (10″×7.5″) — the legacy PowerPoint canvas.** If you don't declare `slideWidth` and `slideHeight` at the `pptx` root, content authored for any other format will leave a white strip on the unused side. This is a silent failure: schema validation passes, the PPTX opens fine, but the layout is broken. `preflight.py` blocks on missing canvas.

Three presets cover the great majority of cases.

### 16:9 small (`slideWidth: 10, slideHeight: 5.625`)

The local-templates default. Compact and convenient when the deck is consumed in a sandbox PDF preview.

### 16:9 standard (`slideWidth: 13.333, slideHeight: 7.5`)

The PowerPoint/Keynote widescreen default. Best for projection and full-screen viewing.

### 1:1 carousel (`slideWidth: 7.5, slideHeight: 7.5`)

LinkedIn carousels, Instagram. Compact horizontal space; type scale uses body=18.

### 4:5 vertical (`slideWidth: 7.5, slideHeight: 9.375`)

LinkedIn portrait, Instagram feed. More vertical room for narrative.

Avoid cinematic 16:10 or 21:9 unless explicitly requested. **Don't use the 4:3 default unless the audience explicitly asked for it** — it's the "old PowerPoint" look.

## Grid & margin presets

### 16:9 (12×6 grid, small canvas — the local templates' default)

```json
"grid": {
  "columns": 12, "rows": 6,
  "padding": 0.55, "gutter": 0.2
}
```

Cell ≈ 0.74 in wide × 0.74 in tall (≈53pt vertical). One row ≈ 53pt — fits an h2 line with margin.

### 16:9 standard (12×12 grid)

```json
"grid": {
  "columns": 12, "rows": 12,
  "margin": { "top": 0.5, "right": 0.5, "bottom": 0.5, "left": 0.5 },
  "gutter": { "column": 0.16, "row": 0.16 }
}
```

Cell ≈ 0.88 in wide × 0.40 in tall (≈28pt). One row ≈ 28pt — fits a body line, not an h1.

### 1:1 carousel (12×12 grid)

```json
"grid": {
  "columns": 12, "rows": 12,
  "margin": { "top": 0.6, "right": 0.6, "bottom": 0.6, "left": 0.6 },
  "gutter": { "column": 0.12, "row": 0.12 }
}
```

Cell ≈ 0.415 in square (≈30pt vertical).

### 4:5 vertical (12×16 grid)

```json
"grid": {
  "columns": 12, "rows": 16,
  "margin": { "top": 0.5, "right": 0.5, "bottom": 0.5, "left": 0.5 },
  "gutter": { "column": 0.12, "row": 0.12 }
}
```

A 16-row grid on tall canvases gives finer vertical control. Cell ≈ 0.43 × 0.41 in (≈30pt).

## Grid vs absolute positioning

- **Grid** (preferred for content): `text`, `chart`, `table`. Easier to maintain, reflows when grid changes.
- **Absolute** (`x`, `y`, `w`, `h`): decorative shapes, logos, edge accents, page strips. Use when content position depends on the slide canvas, not the content grid.

Never mix grid and absolute on the same element. Pick one per node.

## Vertical rhythm: lineSpacing rules

1. **Always set lineSpacing explicitly.** Never rely on renderer defaults. Even when applying a theme `style`, restate `lineSpacing` in any text element with overridden `fontSize` — the placeholder height assumes the _original_ style's line height.
2. **lineSpacing follows the type scale.** Approximate ratios: `fontSize × 1.25` for body/headings, `× 1.15` for display, `× 1.05` for hero. Never use `lineSpacing < fontSize` (lines collide); avoid `> fontSize × 1.5` (loose, amateur).
3. **Paragraph spacing is structural, not vertical filler.** Group two paragraphs with `paraSpaceAfter: 4`; separate them with `paraSpaceAfter: 16+`. Never use `lineSpacing` to make gaps between paragraphs — that breaks the baseline.

### Worked example — wobbly content slide

Symptom: title fine, but body floats too low and caption sticks to body.

Diagnosis: title `style: heading1` inherits `lineSpacing: 38` (wrong, should be 44); body `fontSize: 14` inherits theme default 16 (too tight); caption `fontSize: 11, lineSpacing: 11` (collides), `paraSpaceBefore: 0`.

Fix: title → explicit `lineSpacing: 44`. Body → snap to scale `fontSize: 16, lineSpacing: 24`. Caption → `fontSize: 12, lineSpacing: 18, paraSpaceBefore: 8`.

All values land on the 4pt baseline; visual rhythm is restored.

## Decorative anchor patterns

Decorative shapes (dots, bars, lines, ghosts) make or break visual identity. Five vetted patterns. Pick one per template, commit to it.

### 1 — Top accent strip

```json
{
  "name": "shape",
  "props": {
    "type": "rect",
    "fill": { "color": "accent" },
    "x": "0%",
    "y": "0%",
    "w": "100%",
    "h": "0.5%"
  }
}
```

Variant: short asymmetric bar with `w: "20%"`.

### 2 — Corner cluster (3-4 dots)

```json
{
  "name": "shape",
  "props": {
    "type": "ellipse",
    "fill": { "color": "accent" },
    "x": "92%",
    "y": "92%",
    "w": "1.2%",
    "h": "1.6%"
  }
}
```

Aspect compensation: ellipse `h_pct = w_pct × (slide_width / slide_height)`. On 16:9 (1.78×), on 1:1 (1.0×), on 4:5 (0.8×). Otherwise circles render as visible ovals.

### 3 — Vertical edge accent

```json
{
  "name": "shape",
  "props": {
    "type": "rect",
    "fill": { "color": "primary" },
    "x": "0%",
    "y": "0%",
    "w": "0.5%",
    "h": "100%"
  }
}
```

Editorial / magazine feel.

### 4 — Diagonal cut

```json
{
  "name": "shape",
  "props": {
    "type": "rect",
    "fill": { "color": "accent" },
    "x": "-10%",
    "y": "60%",
    "w": "120%",
    "h": "20%",
    "rotate": -8
  }
}
```

Use sparingly — once per deck, on cover or section divider.

### 5 — Number ghost

A massive faded numeral behind a section divider title. **Text components do not accept `transparency`** — fake the fade by using a `color` close to the background:

```json
{
  "name": "text",
  "props": {
    "text": "01",
    "x": "60%",
    "y": "10%",
    "w": "40%",
    "h": "60%",
    "fontSize": 240,
    "lineSpacing": 240,
    "color": "EFEDE8",
    "align": "right",
    "valign": "top"
  }
}
```

Pick `color` ~5-15% darker than background (`#FAFAFA` → `EFEDE8`).

For genuine semi-transparent decoration, use `shape` with `fill.transparency`. Layer for stencil effects (transparent shape + opaque text on top).

### Decorative anti-patterns

- Multiple unrelated patterns on the same slide. Pick one anchor pattern.
- Floating dots scattered in the center with no anchor.
- Decorative elements over content placeholders unless transparency > 80.
- Same decorative pattern on every template — vary across cover / content / section divider.

## Pre-flight workflow

Before rendering, run the calculator:

```bash
python3 <skill>/scripts/preflight.py my-deck.pptx.json
```

It walks every text node, computes the rendered height vs. the declared bounding box (grid or absolute), and reports OVERFLOW / TIGHT / OK. `render_preview.py` runs it automatically and **fails on OVERFLOW**.

Mandatory for any deck with text placeholders containing >40 characters or fontSize >24pt — which is most decks. The check costs milliseconds. Skipping it has cost real iteration time on every multi-slide deck.

## Common positioning failures

### Title centered when it should be off-center

**Cause:** placeholder spans 12 columns and `align: center` inherits from the theme.
**Fix:** restrict to `columnSpan: 8-9`. Override `align: left` explicitly.

### Subtitle drifts down as the title grows

**Cause:** title and subtitle share adjacent grid rows with no spacer.
**Fix:** leave a 1-row buffer between them. Wasted row absorbs growth.

### KPI numbers not vertically centered in their cards

**Cause:** `valign: middle` on a text that overflows pulls the overflow up; perceived center shifts.
**Fix:** `valign: top` + explicit `paraSpaceBefore`.

### Decorative circle renders as a visible oval

**Cause:** ellipse `w` and `h` use the same percentage but the slide is not square.
**Fix:** apply aspect compensation (see Decorative anchor patterns).

### Render uses default Office blue/green despite a custom theme

**Cause:** theme file's `name` doesn't match the document's `props.theme`.
**Fix:** make them byte-equal.

### Vertical rhythm feels off across slides even though each slide validates

**Cause:** different slides override `lineSpacing` ad-hoc.
**Fix:** define lineSpacing once in theme `styles`. Don't override at slide level unless absolutely necessary.

## Common prop confusions

### Text components: `color` vs `fontColor`

Text components use `color`. `fontColor` is for theme `styles` and for **shape** components (text inside the shape). Setting `fontColor` on a `text` component is silently ignored.

```jsonc
{ "name": "text",  "props": { "color": "primary" } }     // ✅
{ "name": "text",  "props": { "fontColor": "primary" } } // ❌ ignored
{ "name": "shape", "props": { "fontColor": "FFFFFF" } }  // ✅ text-in-shape
```

### Text components: no `transparency`

Text doesn't accept `transparency`. Use a `color` close to the background. `transparency` is valid on shape `fill` and `image`.

### Hex prefix: `#` only inside themes and DOCX

| Surface                     | Example                | Notes                           |
| --------------------------- | ---------------------- | ------------------------------- |
| Theme file (`*.theme.json`) | `"primary": "#1A1A1A"` | `#` required                    |
| PPTX component              | `"color": "FFFFFF"`    | **no** `#`                      |
| DOCX component              | `"color": "#1A1A1A"`   | `#` required (opposite of PPTX) |
| Theme key in either         | `"color": "primary"`   | always works                    |

Reach for raw hex only when the color isn't a theme token.
