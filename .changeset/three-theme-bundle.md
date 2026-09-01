---
'@json-to-office/core-docx': major
'@json-to-office/shared-docx': patch
'@json-to-office/jto': patch
---

The bundled DOCX theme set is now `minimal`, `devportal`, `vermilion`.

`corporate`, `apex` and `modern` are removed, along with the exported
`corporateTheme` and `modernTheme` consts (`devportalTheme` and
`vermilionTheme` are exported instead). A document naming a removed theme
falls back to `minimal` with the existing `W_UNKNOWN_THEME` warning; to keep
one of the removed looks, copy its last shipped JSON into your own theme file
and load it with `--theme-path` / `customThemes`.

The three surviving themes set their `mono` font role to Courier New. Every
family they name — Helvetica, Arial, Calibri, Courier New — has a
metric-compatible substitute in the hosted playground's LibreOffice preview
(Liberation Sans, Carlito, Liberation Mono), so the PDF preview breaks lines
where Word does; Menlo and Consolas, the previous mono roles, fall back to
DejaVu Sans Mono with different advance widths.

`vermilion` now ships `componentDefaults` — the `vermilion-annual-report`
table recipe (gray hairline rows, open sides, full width, red bold headers
over a red hairline, 9.5pt cells with roomy padding) plus em-dash list
markers, centered images/statistics and `section.pageBreak: false` — so a
bare table on `vermilion` looks like the annual report instead of a default
grid.

Tables also breathe: a body paragraph or list item directly above a table now
keeps at least 12pt of space before the table's top rule (a stated
`spacing.after` still wins), and the last item of a list no longer inherits
the inter-item gap — it falls back to the body style's space-after, so lists
stop ending a couple of points before whatever follows.

The two shipped example documents were replaced, and the themes now carry
their looks outright. `proposal` and `technical-guide` gave way to
`practice-note` — a single-column Atelier Still note — and `field-review` — a
two-column Northstar editorial with column breaks, pull quotes and a
scorecard table. Their palettes and type were folded into the themes:
`minimal` is now Calibri with sage-green ink on ivory, `devportal`
(displayName "Field Editorial") is Helvetica in near-black ink with a
burnt-orange accent, and both examples state `props.theme` and no
`themeOverrides` at all. The exported `proposalExample`/
`technicalGuideExample` loaders are now `practiceNoteExample`/
`fieldReviewExample`, and the `-t proposal` / `-t technical-guide` CLI
template names are now `-t practice-note` / `-t field-review`.

A table where no column declares a `header` no longer emits an empty header
row — previously an invisible phantom that any theme header fill would
suddenly paint as a bare tinted band.

The playground templates and remaining documents no longer restate
values their theme already provides (table borders and recipe, list markers,
image alignment, first-section page breaks, a background color override) —
verified byte-identical before and after.
