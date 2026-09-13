---
'@json-to-office/mcp-server': minor
---

`jto_validate` checks what a document points at — the two defects that used to surface only at generation.

**A `props.theme` that names no theme** is `W_UNKNOWN_THEME` at `/props/theme`, in both formats, with the themes that exist in the suggestion. It advises rather than blocks: generation falls back to the built-in default and renders. An inline pptx theme object names nothing and is never reported. The pptx `jto_generate` warning for the same defect now carries the `/props/theme` pointer too, and stops suggesting a path to a theme file — `props.theme` is only ever looked up by name; a theme file arrives as `themePath`.

**An image file that cannot be read** is `E_ASSET_UNREADABLE` at the image's `props/path` (slide and visual backgrounds included). `jto_validate` now takes `baseDir` and resolves relative paths against it, or the server working directory, exactly as generation does; URLs and data URIs are not checked. The verdict follows what generation does with the image: a DOCX table cell draws a text placeholder instead of failing, so there it is `W_ASSET_UNREADABLE`; PPTX never reads a file outside `baseDir` or the working directory and drops the image, so there it is the `W_IMAGE_PATH_OUTSIDE_ROOTS` warning generation itself reports.

**`jto_generate` blames the image, not itself.** A render that failed over a missing image came back as `E_INTERNAL` "Failed to load image from …", the code reserved for bugs in this server. It now answers with the same `E_ASSET_UNREADABLE` diagnostics `jto_validate` gives, at the image's pointer, in both formats and on every renderer; `jto_preview`'s build failure leads with them as well.
