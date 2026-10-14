---
'@json-to-office/core-docx': minor
'@json-to-office/shared': minor
'@json-to-office/jto-cli': minor
'@json-to-office/mcp-server': minor
'@json-to-office/jto': minor
'@json-to-office/core-pptx': patch
---

A DOCX can now carry its fonts. The new `embed` export mode (`fonts.mode: 'embed'`, `--font-mode embed`, `fonts.mode` on `jto_generate`, or **Embed fonts in the file** in the playground's export dialog) keeps the font references as `custom` does and writes the resolved TTF/OTF files of every non-safe family into the document, so Word, LibreOffice and Google Docs show the typeface on a machine that does not have it installed. It is opt-in: `custom` stays the default, and `custom` and `substitute` build exactly the bytes they did before.

Each family embeds up to four faces, the four Word's font table addresses: regular and italic from weight 400, bold and bold italic from 700, or from 500 and 600 when those are missing. Other weights stay references, with a `FONT_EMBED_WEIGHT_DROPPED` warning, because Word for Mac silently substitutes a face it cannot address by bold and italic. WOFF, WOFF2, EOT and Type 1 sources are skipped (`FONT_EMBED_SKIPPED_FORMAT`); the `OS/2.fsType` licence bits are honoured, skipping a restricted face (`FONT_EMBED_SKIPPED_LICENSE`) and flagging one licensed for preview & print, which Word opens read-only (`FONT_EMBED_READ_ONLY`). One `FONT_MODE_EMBED` warning summarises what embedded. Whole font files are embedded, not subsets. Deterministic builds derive each font's obfuscation key from its bytes, so the same JSON still builds the same file.

Embedding needs the default `docxjs` renderer (docx 9.10). On `office-open` the mode falls back to `custom` with `FONT_EMBED_UNSUPPORTED_RENDERER`, and a PPTX falls back the same way with `FONT_EMBED_UNSUPPORTED_FORMAT`. `toEmbeddedFontFaces` (face selection) is exported from `@json-to-office/shared/fonts/node`.
