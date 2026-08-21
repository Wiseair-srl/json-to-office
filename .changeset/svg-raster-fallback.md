---
'@json-to-office/core-pptx': minor
---

Ship a real raster fallback for inline `svg` images instead of a broken-image
placeholder, and expose a `warnings` sink on `PresentationPackagingOptions`.

An SVG picture travels as two media parts: the SVG itself, referenced by
`<asvg:svgBlip>` inside the blip's `<a:extLst>`, plus a PNG preview referenced
by the `<a:blip r:embed>` that every consumer understands. PptxGenJS builds
that preview with a browser canvas, so under Node it writes its hardcoded
broken-image placeholder instead (gitbrent/PptxGenJS#401) — and every viewer
without svgBlip support drew a red X where the artwork belonged. PowerPoint
2016+ reads the vector and was never affected, which is why the shipped
templates looked fine locally and broke in the LibreOffice-backed preview.

`packagePresentationBuffer` now pairs each svgBlip with its preview part
through the slide/layout/master rels and overwrites the placeholder with a
resvg rasterization sized for the box the picture is placed in (~288 DPI,
capped at 4096px, cached by content). The pass is best-effort: a missing
native binding or an SVG resvg rejects leaves the package exactly as generated
and reports `IMAGE_SVG_RASTER_FAILED`, so a broken preview can never fail a
build — but it is no longer silent, which was half the defect.
