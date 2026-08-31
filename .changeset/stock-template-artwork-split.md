---
'@json-to-office/jto': minor
---

Every stock DOCX template now draws its page decoration as one component per
motif instead of one page-sized rendering.

Each page carried a single page-sized SVG — or, in the `modern-annual-report-2`
and `-3` covers, a single page-sized pptx slide rasterized to PNG — with every
unrelated mark baked into it: a background wash, a diagonal hatch field, a lens
motif, hairline rules. Those are now separate, individually placed components,
which is what makes them addressable as data rather than as one opaque asset.

Four things shaped how far the split could go:

- `zIndex: 0` is not "unset". docx.js reads it as absent and derives
  `relativeHeight` from the image height, which put the full-page backdrop on
  top of the artwork it backs. Every motif now states an equal, non-zero
  `zIndex`: Word stacks by `relativeHeight`, LibreOffice ignores it and uses
  document order, and equal values are the one arrangement both agree on.
- Each floating drawing costs an anchor paragraph and the schema exposes no line
  height to zero it, so 269 of them pushed `standard-annual-report` from 20
  pages to 25. Page decoration therefore lives in the section header, which
  holds the same page-relative offsets and takes no part in the body flow. Every
  section needs one — a section without a header inherits the previous
  section's, which painted one page's decoration across the next.
- A `visual` rasterizes to opaque RGB, so its pieces may not overlap.
  `modern-annual-report-3` splits into non-overlapping clusters.
  `modern-annual-report-2`, whose every page sits on a full-canvas backdrop,
  could not — so its `rect`/`roundRect`/`ellipse`/`line`/`pie` elements are
  reauthored as inline SVG, which is transparent, and 23 of its 25 pages no
  longer need the pptx rasterizer at all. The two visuals carrying text stay
  visuals: SVG has no line wrapping.
- PPTX has a real shape vocabulary, so `minimalist-pitch-deck`'s laptop mockup
  and chart gridlines are native shapes rather than pictures — editable in
  PowerPoint instead of flattened.

Verified against a pre-change render of all nine templates: page counts
unchanged and nothing solid moves. Exact pixel equality is not reachable and was
not claimed — LibreOffice re-emits each embedded SVG through its own 1/100 mm
grid, so hairline anti-aliasing lands differently; the check is an eroded diff
mask, which keeps a mark that moved and discards a hairline that shifted a
fraction of a pixel.

Left alone deliberately: `management-plan`'s icons, since a six-path glyph is
one mark rather than six, and `data-report-presentation`'s funnel, whose five
polygons are irregular quadrilaterals tiling edge to edge where separate
rasterizations would seam.
