---
'@json-to-office/shared-pptx': patch
'@json-to-office/shared-docx': patch
'@json-to-office/jto': patch
---

Fix `"theme"` autocomplete offering the wrong set of themes

Two independent defects left the playground's `"theme": ""` completion
showing four names on a pptx deck when eleven were available.

The pptx schema hardcoded its own copy of the built-in names, so `vermilion`
and `devportal` were completable on docx and invisible on pptx for as long as
they shipped. Both formats now build the description and the `examples` from a
single exported list, and guard tests pin the theme registry to it.

Custom themes were dropped entirely on pptx: the injector checked `type ===
'string'` before anything else, and pptx declares `theme` as `string | inline
theme config` — a union node with `anyOf` and no `type` of its own. It now
recurses into union branches first, so themes served from the playground's
theme library complete alongside the built-ins.
