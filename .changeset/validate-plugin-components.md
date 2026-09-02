---
'@json-to-office/core-docx': minor
'@json-to-office/jto-ops': minor
'@json-to-office/jto': patch
---

`/validate` knows the plugin components the rest of the server knows.

The dev server's `POST /api/<format>/validate` validated against the standard components alone, so a document naming a registered plugin came back `Unknown component "weather"` — the same name the schema route had just offered for completion and the generator would have expanded happily. The route now hands the registered components to the plugin-aware validator, which defers those nodes from the standard walk and checks each one's props against the version it resolves to. With no plugins registered nothing changes: `weather` is still unknown, which is the honest answer from a server that cannot build it either.

Doing that exposed a second defect, in `core-docx`'s plugin validator itself: its walk returned at the first node that was not a custom component instead of descending, so it only ever checked components at the top level. A plugin component inside a `section` — every real document — was never validated against its props schema, by this route or by the pre-generation gate; `city: 123` passed both and failed later inside the component's own render. It now descends whatever the node is, matching what `core-pptx` already did. Custom components carried in props rather than `children` (a header, a table cell) are still outside this pass.

`FormatAdapter` gains an optional `validateDocumentWithPlugins(doc, plugins)`, async because the core that owns the plugin-aware validators is imported on demand. Callers with an empty registry keep using the sync `validateDocument`.
