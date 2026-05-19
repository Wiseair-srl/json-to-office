# Chart design taste

Distilled from open-codesign's `chart-svg` design skill. Apply to `chart` components in both DOCX and PPTX.

## Picking the chart type

- **Time-series** (revenue over quarters, traffic over months) → **line** or **area**
- **Categorical comparison** (revenue by region, votes by candidate) → **bar** (horizontal if labels long)
- **Share-of-total** (≤6 slices, sums to 100%) → **donut** (skip if >6 — use bar)
- **Trend in a tile** (KPI card with sparkline) → **sparkline** (no axes, no labels)
- **Two correlated dimensions** → **scatter**, never paired bars

If unsure, **bar chart**. Bars are the lowest-risk choice and almost never wrong.

## Color

- One accent stroke per series. Don't rainbow.
- Fill = accent at **15–18% opacity** (or HSL with reduced lightness for fills).
- Comparison series: derive from accent — accent + accent-darker / accent-lighter. Don't pick unrelated hues.
- Grid lines: very light (`rule` token at ~50% — close to bg). 1px stroke.
- Axis labels and tick text: muted token (mono family, 10–12pt, tabular-nums).
- Background: `bg` token. Don't paint the chart white on a colored slide.

## Layout

- Inner padding **≥32px** from chart bounds before drawing.
- Max **4–5 axis ticks**. Round to clean numbers (10, 25, 100). Never `1.347`.
- Bar width: ~62% of slot; gap: ~38%.
- Line charts: 2px stroke, rounded line-caps, endpoint dots (3px radius, bg fill, accent stroke 2px).
- Area fills: same accent at low opacity, never solid.
- Y-axis baseline: 1px stroke in `rule` token, sitting on the data area.

## Labels & legends

- Number labels: mono or sans with **tabular-nums always**. Italic numbers = visual bug.
- Decimals: be consistent across the whole chart. Either all `1.2` or all `1.234`, not mixed.
- Units in the axis title or as a subtitle ("Revenue (USD M)"), not appended to every tick.
- Legend only when >1 series. Place above-right or below, in `caption` style (11pt sans muted).
- Never use 3D, glow, shadow, or gradient on data marks.

## Anti-patterns

- Default library colors (pptxgenjs auto-palette). Always specify.
- More than 4 lines on one chart — split or aggregate.
- Pie chart with >6 slices.
- Y-axis not starting at 0 on a bar chart (unless data is bounded above 0 with a stated reason).
- Cluttered grid (gridlines every 1 unit, ticks at every value).
- 3D bars / pies. Ever.
- Chart title in the same family/size as the slide H2 — they fight.
