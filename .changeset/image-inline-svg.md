---
'@json-to-office/core-docx': minor
'@json-to-office/shared-docx': minor
---

feat(docx): accept raw inline SVG markup as an image source

The `image` component gains an `svg` prop alongside `path`/`base64`, so callers can drop raw `<svg>…</svg>` markup straight into the JSON instead of encoding it as a data URI or pointing at a file. Source precedence is `svg > base64 > path`; the markup is wrapped into an `image/svg+xml` data URI and flows through the existing pipeline, so it renders as a true vector (Word 2016+, with the usual PNG fallback) and honors width/height (intrinsic viewBox size when omitted), `%` widths, alignment, caption, floating, and table-cell placement.

Resolution is centralized in a shared `resolveImageSource()` helper used by every image render path (block, table cell, column layout).

The three sources are mutually exclusive: document validation now rejects an image that sets more than one of `path`/`base64`/`svg` (a semantic rule the structural schema can't express), with a path-aware error pointing at the offending component anywhere in the tree.

Adds an `eldermoor-census` example custom component demonstrating how to expose structured data props and render them via the inline `svg` image source.
