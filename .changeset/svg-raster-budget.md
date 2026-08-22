---
'@json-to-office/core-docx': patch
'@json-to-office/shared-docx': patch
'@json-to-office/jto': patch
---

Cap the inline-SVG raster fallback by area, so a page of them cannot exhaust
the renderer.

`SVG_RASTER_SCALE` is applied to one edge, which says nothing about how big the
bitmap gets: resvg renders RGBA, so a full-page SVG at 3x is 2382x3367 ≈ 8 MP ≈
32 MB live. The annual-report templates carry two dozen page-sized SVGs, which
took one render past 1.1 GB and had the hosted playground's container killed
mid-request — the reader saw the proxy's HTML error page, not a document. The
edge is now also capped so the whole bitmap stays within 1 MP, which keeps a
full page near 120 DPI; only Word before 2016 ever draws this fallback, since
everything newer draws the vector. Small SVGs are untouched.

Report the failure in terms an author can act on. The playground parsed every
generate response as JSON, so a proxy's HTML error page surfaced as
`Unexpected token '<', "<!DOCTYPE "... is not valid JSON`. It now reads the
body only when it is JSON and, when it is not, names the likely cause — a
502/503/504 says the server ran out of memory or restarted mid-request.

Express the two `renderAs: "shape"` limits in the JSON Schema as well as in the
deep validator. The validator only runs when a document is generated, so a
shape missing its height was reported at Run; `if`/`then` puts the same rule
where the editor can underline it while it is being typed.
