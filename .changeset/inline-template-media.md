---
'@json-to-office/jto': patch
---

fix(server): inline bundled template media as data URLs in safe mode

Deployed playgrounds run with `OUTBOUND_SOURCE_MODE=safe`, which rejects the
relative `media/...` paths every bundled template ships with — and docx
`visual` components ship their JSON to the remote rasterizer, which has no
access to those files anyway. When a request's `sourceName` matches a
server-discovered document, its relative image references (image components,
`{ image: { path } }` backgrounds, visual elements) are now resolved against
the document's directory, containment-checked, and inlined as `data:` URLs
before outbound-source validation. Arbitrary client paths stay blocked;
development mode keeps filesystem resolution untouched.
