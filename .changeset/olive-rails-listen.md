---
'@json-to-office/jto': minor
---

Rebuild the playground sidebar around the files you have open.

The rail carried two competing ideas at once. "Active Documents" and "Active
Themes" were the working set; "Discovered Resources" was the library — but the
library nested its files two levels deep (Discovered Resources → Project
Documents → the file), so a 256px column spent roughly 40px of its width on
chrome before showing a filename. There was no way to search any of it. With a
dozen documents, themes and plugins in the project, scanning was the slowest
thing about the panel.

The library sections are now top level, one indent, one neutral tree guide. A
single filter across the top narrows open files, project files and plugins
together, auto-expanding whatever still has matches; `/` focuses it, `Esc`
clears it, and matched runs are marked with weight rather than a tint, because
every hue in this rail already means something.

State reads more precisely and more quietly. The file icon no longer swaps to a
play glyph when a document is previewing — that swap cost the only cue
distinguishing a document from a theme. Instead exactly one row carries a filled
bed and a `--primary` stripe (the one the editor has open), while previewing and
theme-in-use are marked with a `--data-blue` or `--warning` dot on the trailing
edge. Decorative left stripes are gone from the library rows, so a stripe now
only ever means "open in the editor". The collapsed rail shows real file icons
in place of two-letter monograms, which had rendered both `contract-v1` and
`contract-v2` as "CO".

Rows are denser (28px, 13px text, 14px icons) and each one reveals an overflow
menu on hover — rename, download and delete had been reachable only by
right-clicking. Empty sections are buttons that create the thing they are empty
of. Plugin names now label their switch, so toggling a plugin is a 28px row
target rather than an 18px track.

Muted text was recalibrated: several rail values sat below WCAG AA (section
labels at 3.4:1, counts at 2.1:1). Rail text now lives in a documented
`/65`–`/85` opacity band and takes its hierarchy from size, weight and uppercase
tracking instead of fading out.

Two dead paths went with the rewrite: a `SchemaDialog` whose open-state setter
was never called, and a per-render `JSON.parse` of every open document feeding an
indicator prop the row component ignored.
