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

PPTX chart labels and table defaults can now carry a font weight. The five
chart font-face props (`titleFontFace`, `legendFontFace`, `dataLabelFontFace`,
`catAxisLabelFontFace`, `valAxisLabelFontFace`) each gained a `*FontWeight`
companion, and `TablePropsSchema` gained a table-level `fontWeight` next to its
table-level `fontFace`. Both run through the same `synthesizeFamilyName` seam a
run-level `fontFace`/`fontWeight` pair does, so `{ dataLabelFontFace: "Inter",
dataLabelFontWeight: 300 }` renders as the `Inter Light` face. Previously the
only weight-ish companion in the chart schema was the boolean
`dataLabelFontBold`, and tables had a weight per cell but none at table level —
so nine sites across the shipped decks rendered Regular where the design said
Light or Medium. Those weights are restored. The legend is the one slot
PowerPoint gives no bold toggle: `legendFontWeight: 700` renders Regular and
emits a new `CHART_FONT_WEIGHT_DROPPED` warning.

**Rasterizer font-cache keys change.** `fontsDigest` now hashes the decoded
font bytes rather than the base64 text, matching its own documented
content-addressed contract — three spellings of the same bytes (padded,
unpadded, newline-wrapped) previously staged identical fonts under three keys.
Existing font-bearing entries in the rasterizer's disk cache become unreachable
orphans; fontless entries keep byte-identical keys and are unaffected.

**`/rasterize` now rejects malformed font data.** `RasterizeFontFaceSchema.data`
is held to a strict base64 pattern instead of relying on `Buffer.from`, which
silently tolerates whitespace, `data:` prefixes and invalid characters and so
let garbage reach LibreOffice. Third-party clients sending MIME-wrapped or
`data:`-prefixed base64 now get a 400; in-repo producers are unaffected, and
the docx side already retries without fonts when a server 400s. The route also
honours the configured body limit instead of a hardcoded 32 MiB, clamped to a
64 MiB ceiling.

**WOFF/WOFF2 faces are no longer forwarded to the rasterizer.** Every stager
renames a face via `rewriteFontFamilyName`, which returns non-sfnt input
unchanged — so a web font was either unparseable or indexed under the wrong
family, and rendered as a silent fallback either way. Only `ttf`/`otf` are sent
now, via an allowlist so a newly added format stays excluded until a stager
supports it.
