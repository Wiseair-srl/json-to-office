---
'@json-to-office/shared': minor
'@json-to-office/shared-docx': minor
'@json-to-office/shared-pptx': minor
'@json-to-office/core-docx': minor
'@json-to-office/core-pptx': minor
'@json-to-office/jto-cli': minor
'@json-to-office/jto': minor
---

Make custom fonts work end to end, especially in hosted playgrounds.

`props.fontRegistry` and a theme-level `fontRegistry` now actually resolve
fonts. The field was documented in the schema and in the guide, but nothing
read it: validation and `FontRegistry` saw only `options.fonts.extraEntries`,
so a correctly declared non-safe family still warned `FONT_UNRESOLVED` and
previews fell back to a host font. Precedence is theme < document < runtime. A
registry is treated as a declaration rather than a set of references, so its
entries no longer self-satisfy validation and `substitute` mode no longer
renames a registration onto a SAFE_FONTS name.

Font warnings now reach the caller. They were collected in core and then
dropped at the `FormatAdapter` seam, because `emitGenerationWarnings` routes to
a diagnostics sink that is a no-op outside an interactive CLI task. Generation
warnings are also cached alongside the buffer, so they survive a repeat render
of the same document. `jto pptx generate` previously printed no core warnings
at all; it now does.

The playground gained a **Custom** font tab: upload a TTF/OTF, or embed any
Google family through the materialize endpoint. Both become self-contained
`kind: "data"` registry entries, so the font travels with the JSON. The fast
in-browser preview now synthesizes an `@font-face` block from the registry,
including rules for the synthetic sub-family names that intermediate weights
are written as, so a `fontWeight: 300` run no longer renders as Regular.

Docx `visual` components are rasterized to PNG by an out-of-process
LibreOffice, which previously received no font bytes and so rendered every
custom family in a fallback. Resolved fonts are now forwarded to the
rasterizer and staged around its `soffice` launch, and the rasterizer's
content-addressed cache key absorbs a font digest — without that, a shared
render server would serve one document's fontless PNG to another.

Also: Geist, Geist Mono, Space Grotesk and Archivo joined the bundled Google
catalog, and the shipped templates stopped hand-authoring synthesized family
names like `"Geist Light"` — a shape the renderer emits, never one it accepts.

**Behaviour change:** generating a document that contains a `visual` now
materializes fonts (including Google Fonts network fetches) even with no
preview listener attached, because the rasterizer needs real font files.
Documents without a `visual` are unaffected.

**Deploy ordering:** ship `jto-render-server` before the playground. Both
rasterize schemas are `additionalProperties: false`, so a `fonts`-bearing body
reaches an old server as a 400 rather than being ignored. The batch path
retries once without fonts, but ordering avoids the wasted round trip.
