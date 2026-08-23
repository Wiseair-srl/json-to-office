---
'@json-to-office/shared': major
'@json-to-office/jto-cli': major
'@json-to-office/jto': patch
---

Remove the retired generic component-cache subpath and its unused public
helpers. Renderer generation remains stateless; only document-output, asset,
font and rasterizer caches remain.

Rename the format-adapter reset hook from `clearComponentCache` to
`resetCacheStats`, matching its remaining responsibility, and update the
playground cache-clear message.
