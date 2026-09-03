---
'@json-to-office/mcp-server': minor
---

The nine designed templates now ship inside the package, discoverable with no network.

They were reachable only from the playground that serves them, which meant the cold path — an agent on Claude Desktop with the server and nothing else — never saw a designed document at all. Now `jto_discover` lists every template with a manifest: archetype, theme, a **measured** page count, a component inventory, a slot inventory saying how many text properties an author actually fills, and a sentence on when to reach for it. `jto://templates/<name>` returns the document; `jto://templates/<name>/thumbnail` returns every page tiled into one low-DPI image, which is what to look at before pulling several hundred kilobytes of JSON into a context window.

The manifest is generated from the documents by `pnpm generate:gallery` and re-derived by `pnpm validate:assets`, which fails when a document has changed since its manifest was written, when a template has no "when to use" note, or when a bundled document or thumbnail is missing. A manifest that drifts from its document is worse than no manifest: an agent picks a template on what the manifest claims and finds out afterwards.

Two things are deliberately absent. The **photographs** are not shipped — each manifest lists the image paths its template expects, so an agent copying one knows to supply its own rather than send a client someone else's stock imagery. And **fonts are listed separately** from images, because they are a different problem: a missing photograph is a gap the author fills, a missing typeface silently changes what the whole document looks like.

**Package size**: 470 KB → 3.71 MB packed, 1.82 MB → 5.09 MB unpacked. The documents contribute 247 KB — they are gzipped, which takes 3.4 MB of coordinate compositions down by a factor of fourteen and is the difference between a bundle worth shipping and one that is not; they are decompressed on read, so a client that never opens a template never pays for one. The remaining ~3 MB is the nine thumbnails, at 180 px per page. That is the whole increase, and it buys the thing the bundle is for: at that size a page render is still legible enough to choose a template by, and below it the sheet only tells you a page exists.
