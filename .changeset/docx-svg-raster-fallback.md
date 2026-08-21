---
'@json-to-office/core-docx': patch
---

Rasterize the fallback image an inline `svg` ships for readers that cannot draw
the vector.

A `w:drawing` for an SVG carries two payloads: the vector, which Word 2016+
renders, and a raster fallback for everything older. `createTypedImageRun` was
filling that fallback with the SVG bytes under a `png` type, so Word before
2016 — and any other consumer of the package — resolved the fallback and drew
a broken image. The TODO above it had acknowledged this since the function was
written.

The fallback is now a real PNG rendered with resvg, sized for the placed box at
roughly 288 DPI and capped at 4096px on the long edge. When rasterization is
unavailable or the markup will not parse, the run keeps the historical bytes
and reports an `IMAGE_SVG_RASTER_FAILED` warning: no worse than before for
Word 2016+, and never a failed render.

Warnings raised deep in the render now reach the caller's collector through a
scope alongside the existing base-directory and generation-date scopes, rather
than each intermediate signature having to carry a sink.
