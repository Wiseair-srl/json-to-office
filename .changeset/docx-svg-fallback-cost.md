---
'@json-to-office/core-docx': minor
'@json-to-office/jto-ops': minor
'@json-to-office/jto-cli': minor
---

Inline SVG no longer dominates the cost of rendering a DOCX, and the raster
fallback it produces can be turned off.

Every inline SVG ships twice: the vector, which Word 2016+ and LibreOffice
draw, and a PNG in the `fallback` slot for readers older than that. The
fallback was rasterized one image at a time, which cost about 250ms each and
went unnoticed while a document held a couple of dozen SVGs. Splitting the
stock templates' page decoration into a component per motif took several of
them past two hundred, and generation went from six seconds to seventy-seven.

Two changes, and the second is the one that matters:

- Rasters are produced through resvg's `renderAsync` and in a bounded batch
  rather than a serial loop. `Resvg.render()` is synchronous native code, so
  awaiting it never yields — a batch started concurrently still ran one at a
  time on the main thread, which is why simply starting them together changed
  nothing. `renderAsync` hands each raster to libuv's threadpool instead, worth
  roughly 30% (`standard-annual-report` 76.5s → 54.6s). Concurrency is capped at
  eight so the peak stays within the hosted container's memory, each raster
  already being held to a megapixel.
- `svgRasterFallback: false` — `--no-svg-fallback` on the CLI — skips the raster
  altogether. That is the difference between 76.5s and **2.1s**, and it halves
  the package (1.10 MB → 0.57 MB), because the bulk of an artwork-heavy DOCX is
  fallback PNGs nothing modern ever draws. Rendered output is byte-identical
  through LibreOffice with the flag on or off; the vector is what gets drawn
  either way. docx.js requires the slot to be filled, so the vector bytes go in
  it — the same thing already shipped when a raster could not be produced — and
  only readers old enough to need the raster lose the image. Default is
  unchanged, so no existing output moves.

Corpus goldens digest every byte and none moved, which is also the check that
`renderAsync` produces the same PNG as `render()`.
