---
'@json-to-office/core-pptx': patch
---

Unify the PPTX generation prologue behind a shared generation context.

Both entry points — `generateBufferFromJson` and
`createPresentationGenerator` — now resolve themes, run the export-mode
pre-pass and derive the cache key through `core/generationContext.ts`,
mirroring the DOCX module, so the next root-level prop cannot reach one
pipeline and not the other.

Three divergences closed along the way, all behind
`validation: { enabled: false }` or a constructor default:

- A document without root `props` now renders with the default theme on
  both paths instead of dying with a raw TypeError; `props: null` gets a
  clear error message.
- Conflicting payloads (image `path`+`base64`, text `text`+`runs`) are now
  rejected on the plugin path too, checked on the expanded tree so custom
  components can't emit conflicts either. Previously only the core path
  threw; the plugin path silently resolved by runtime precedence.
- A constructor-supplied string theme naming a `customThemes` entry was
  silently dropped between font resolution and slide processing when the
  document named no theme — slides rendered with the default theme. It now
  applies.

Render-neutral: all 3 stock templates byte-identical via both entry points.
