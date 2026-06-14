# Gotchas

Distilled from real-world failures. Scan this list before validating, and again before presenting the file. Every item has caused a silent layout failure at least once.

## Tables (orientation is the #1 mistake)

- **DOCX tables use `columns`.** Each column has a `header` and a `cells` array.
- **PPTX tables use `rows`.** Each row is an array of cell strings or objects.
- Putting `rows` on a DOCX table or `columns` on a PPTX table validates against a different schema and renders wrong (or not at all).

## DOCX

- **Heading orphans.** Headings at h3 or deeper without `keepNext: true` can land alone at the bottom of a page. Always set `keepNext` for h3+.
- **`lineSpacing` placement.** It goes inside `font`. At paragraph root it's silently ignored.
- **`characterSpacing` shape.** Requires both `type` (`"expanded"` or `"condensed"`) and `value`. `{ "value": N }` alone fails validation.
- **Top-level paragraph `border`.** Not supported at the paragraph root. Only valid inside a `text-box`. For a horizontal rule, use a borderless single-row table or a unicode line.
- **Section header/footer disappearance.** After the first section, omitting `header`/`footer` makes them disappear silently. Use `"header": "linkToPrevious"` / `"footer": "linkToPrevious"`.
- **Table column-width overflow.** Sum of column widths must be ≤ available page width (≈451pt for A4 with 1-inch margins). Otherwise the right-most column spills off the page. The validator may now warn; render still produces a broken document.
- **Cell color vs fill.** `color` on a cell is the **text** color. `backgroundColor` is the fill. To make a dark header bar with white text, set `backgroundColor` + `font.color` on **each column's `header` object** directly — not on `headerCellDefaults`, which is silently overridden by column-level `cellDefaults`.
- **Cover-page paragraph defaults.** The theme's `normal` style silently inflates paragraph heights via `spacing` and `lineSpacing`. On cover pages override both: `lineSpacing: "single"`, `spacing: { before: 0, after: 0 }`.
- **Hex prefix.** DOCX uses `#`. PPTX doesn't. This is **opposite** between formats.
- **`visual` needs a rasterization service.** A docx `visual` renders by rasterizing a pptx canvas to a PNG. `render_preview.py` auto-wires the service; if neither a local LibreOffice + `pdftoppm` pair nor a reachable server is available, generation **errors out** — it does not silently drop the graphic.
- **`visual` units & placement.** `canvas.width`/`height` and element `x`/`y`/`w`/`h` are in **inches** (the rest of DOCX is twips/points). The canvas has **no grid** — position elements absolutely; `grid` placement inside a `visual` misbehaves.
- **Colors inside `visual.elements` are PPTX-style.** The canvas is rendered by the pptx engine, so element hex is **bare (no `#`)** even though the surrounding DOCX uses `#`. Shape text uses `fontColor`, text uses `color`. Theme names (`"primary"`) work in both — prefer them.

## PPTX

- **Canvas defaults to 4:3.** The renderer (pptxgenjs) uses `LAYOUT_4x3` (10″×7.5″) when `slideWidth`/`slideHeight` are omitted at the `pptx` root. Content authored for 16:9 then leaves a ~2-inch white strip at the bottom — a silent failure. **Always set both.** `preflight.py` blocks on missing canvas.
- **Hex prefix.** PPTX uses bare hex (`"FFFFFF"`). **No `#`.** Theme keys (`"primary"`, `"text"`) work without `#` and are preferred.
- **Theme name mismatch.** The `name` field in the theme file must equal `props.theme` in the document, byte-for-byte. Mismatch → silent fallback to default Office theme (blue/green). If your render looks generic, check this first.
- **`color` vs `fontColor`.** Text components use `color`. Shape-with-text uses `fontColor`. Setting `fontColor` on a text component is silently ignored.
- **No `transparency` on text.** Text components don't accept `transparency`. Fake fading by setting `color` to a value close to the background.
- **Grid OR absolute, never both.** A node with both `grid` and `x/y/w/h` produces unpredictable layout.
- **`fontSize` override needs `lineSpacing` override.** When you override `fontSize` from a theme style, override `lineSpacing` too. The placeholder height assumes the style's original line height; otherwise text overflows or floats.
- **4pt baseline.** Every `lineSpacing`, `paraSpaceBefore`, `paraSpaceAfter`, padding, and y-offset is a multiple of 4. If you wrote `27`, round to 28.
- **Type scale.** Use only the documented `fontSize` values for the slide format (see [layout-system.md](layout-system.md)). No arbitrary sizes.
- **rowSpan for multi-line text.** A `rowSpan` equals the _number of lines that fit_, not the number of _lines you want_. Multi-line headings need `rowSpan = expected_lines × rows_per_line + 1` buffer.
- **Ellipse aspect.** Equal `w` and `h` percentages render as ovals on non-square slides. On 16:9 use `h_pct = w_pct × 1.78`.
- **`valign: "top"` for variable-length text.** Reserve `"middle"` for short fixed text (labels, captions). With variable content, `"middle"` distributes overflow both ways and collides with neighbors.
- **Speaker notes.** Every slide should have `props.notes`. Verifiers and printed deck handouts both rely on them.
- **One idea per slide.** >40 words of body text → split into two slides.
- **Template rotation.** In 15+ slide decks, don't use the same template (cover, content, divider, etc.) more than 3 slides in a row.

## Pre-flight & validate ordering

1. `validate.py <file>` — schema correctness.
2. `preflight.py <file>` (PPTX only) — text overflow estimation.
3. `render_preview.py <file>` — actual render. Runs preflight automatically and fails on OVERFLOW.
4. Read each PNG. Inspect for visual issues the model can't compute (color contrast, alignment, decoration placement).

Skipping any of these before presenting a file leads to user-visible defects.

## Content quality

- **No lorem ipsum.** Generate plausible data, names, narratives. Use the user's content faithfully when provided.
- **Real numbers.** No "$X" placeholders. Pick concrete figures.
- **Placeholder images** via `https://placehold.co/{W}x{H}/{bg}/{fg}?text={TEXT}` with theme-matching colors.
- **Diacritics & elision apostrophes in non-English content.** When generating Italian, French, Spanish, German, Portuguese, etc., preserve `à è é ì ò ù ñ ç ü ö ä` and elision apostrophes (`L'`, `dell'`, `un'`, `qu'`). The renderer handles Unicode fine; stripping diacritics for ASCII safety produces obviously broken text ("Perche" instead of "Perché", "mobilita" instead of "mobilità"). Read your output back before shipping.
