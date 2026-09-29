---
'@json-to-office/core-pptx': minor
'@json-to-office/json-to-pptx': minor
---

Bump the `pptxgenjs` rendering backend from 3.12.0 to 4.0.1, pinned exactly
in `@json-to-office/core-pptx` like every other backend.

`@json-to-office/json-to-pptx` no longer declares `pptxgenjs` as a peer
dependency. It never imported it: `@json-to-office/core-pptx` depends on it
directly and no public type names it, so a consumer's own `pptxgenjs` was
never the one that drew the deck. It can be uninstalled.

Every deck the default renderer writes is byte-identical to what 3.12.0
wrote, across the corpus, the gallery templates and the examples. One fix
comes with the bump: an inline SVG that cannot be rasterized now always gets
the red-X preview. pptxgenjs 4 writes that preview from a promise it does not
await, so the part could hold the SVG's own text instead; json-to-office now
writes it, on every failure path, whether or not the package is finalized.
