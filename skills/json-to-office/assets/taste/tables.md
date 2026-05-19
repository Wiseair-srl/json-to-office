# Table design taste

Distilled from open-codesign's `data-table` design skill. Apply to `table` components in both DOCX and PPTX.

## Layout

- **Header row** tinted at ~4–6% gray (or `bg` darkened by 5%). Header text in sans 11pt **600**.
- **Row dividers** via 1px rules in `rule` token. **Don't put borders on every cell** — that's a grid, not a table.
- Outer table border: optional. If used, 1px `rule` token. No double borders, no cell padding < 8px.
- Vertical alignment: top (default), unless cells are exactly one line.
- Padding: **8–12px** vertical, **12–16px** horizontal. Cramped tables look like spreadsheets.

## Column widths

- **Sum to 100%, no overflow.** Don't ship a table where `name=80%` and 5 other columns fight for 20%.
- Wide narrative columns (name, email, description): 20–25%.
- Short factual columns (status, role, count): 8–12%.
- Numeric columns: 10–14% (more if values have units).

## Alignment

- **Text**: left.
- **Numeric**: right, with tabular-nums.
- **Status/tag pills**: left or center within a fixed-width column.
- **Dates**: left, fixed format ("Apr 12, 2024" or `2024-04-12` — pick one per document).

## Numbers

- Tabular-nums on every numeric cell. Mono font for IDs and codes.
- Consistent decimals down a column. `1.20` not `1.2` if the column also has `2.35`.
- Currency: prefix once in the header (`Revenue (USD)`), not on every row.
- Percentages: append `%` to the value; right-align.

## Status badges

- Pill shape: 20px radius, 2px / 10px padding.
- Muted background (8% opacity of the color) + dark foreground (600–800 lightness).
- Standard mappings:
  - Active / OK / Success → green family
  - Inactive / Disabled / Neutral → gray family
  - Pending / Warning → yellow family
  - Failed / Error / Critical → red family
- Sans 11pt, weight 500, normal-case (avoid all-caps unless brand demands).

## Inline visuals (usage bars, sparklines)

- Bar: 4–6px tall, `rule` token track, accent fill, rounded ends.
- Sparkline: 60–80px wide, 16–20px tall, single accent stroke, no axes.
- Number adjacent: tabular-nums, right of the visual, ~30% width.

## Row count

- **>12 rows** on a single slide: split, summarize, or move to an appendix.
- **>30 rows** in a DOCX section: paginate or add header repeat.
- Pagination labels: "1–25 of 247" in sans 11pt muted.

## Anti-patterns

- Borders on every cell (looks like Excel 2003).
- Center-aligned numbers (impossible to compare digits).
- Mixed decimals down one column.
- Color-coded rows with no legend.
- Status badges in 6+ colors — looks like a parking ticket.
- Narrow body text wrapping to 4+ lines inside a cell.
- Headers in serif italic (numerics in italic serif = bug, not style).
