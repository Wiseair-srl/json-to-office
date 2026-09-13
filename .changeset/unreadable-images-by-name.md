---
'@json-to-office/shared': minor
'@json-to-office/core-docx': patch
'@json-to-office/core-pptx': patch
'@json-to-office/mcp-server': patch
---

An image that cannot be read is classified by the error's name, not by its English.

**The cores name the failure.** `@json-to-office/shared` exports `ASSET_UNREADABLE`, the `Error.name` of an image the document names that could not be read, and `assetUnreadableError(source, cause)`, which builds one carrying the path or URL it tried (`source`) and what the read threw (`cause`). The DOCX compiler throws it for a body, header or footer image its loader tried and could not load — the loader used to drop why — and the office-open PPTX renderer throws it for a file it cannot read or a URL that does not answer with the picture, where it used to throw the raw `fs` error or `failed to fetch image …`. The message keeps its `Failed to load image from …` opening and now ends with the reason, such as `HTTP 404 Not Found`; a DOCX download failure no longer repeats the URL inside it. The default PPTX renderer, pptxgenjs, reads images itself and is unchanged.

**The MCP server stops calling them its own bugs.** An image `jto_validate`'s check cannot see — a URL that does not answer, a path fed through a block's string slot — failed `jto_generate` as `E_INTERNAL`, and `jto_preview` as a generic `E_PREVIEW_RENDER_FAILED` whose suggestion, `jto_validate`, found nothing. Where a core names the failure, both now answer `E_ASSET_UNREADABLE`, with the path or URL in `context.source` and no pointer. `jto_docx_diff`, whose redline failed over a missing local image as `E_INTERNAL`, now checks both documents and answers at the pointer in whichever one names the file, tagged `context.side`. When `jto_preview`'s build fails over an image the check does report at its pointer, that finding is the whole answer; the stage failure no longer follows it.
