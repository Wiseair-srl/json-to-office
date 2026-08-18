---
'@json-to-office/core-docx': minor
'@json-to-office/jto-cli': minor
'@json-to-office/jto': patch
---

fix: make the playground's "Copy standard components" reliable and cheap (#155)

The action failed two ways: it was silently disabled until the first Run
(gated on the generated output instead of the editor document), and when it
did run, the clipboard write happened after a slow server round trip — the
click's user activation had expired, so Chromium rejected the write with
`NotAllowedError` even though the request succeeded. The endpoint was slow
by construction: it used the deprecated `getStandardComponentsDefinition`,
which runs a full generation (LibreOffice visual rasterization included)
just to surface the JSON tree.

- `core-docx`: new `expandStandardDefinition()` on plugin generators —
  validation, theme resolution, custom-component expansion, and
  normalization only. No fonts, no layout, no rendering, no external
  services. Returns `StandardDefinitionResult`.
- `jto-cli`: `GeneratorResult.getStandardDefinition` wires the new cheap
  path (replaces the deprecated `getStandardComponentsDefinition`
  pass-through, which no longer had in-repo callers).
- `jto` server: `/standard-components` uses the expansion-only path and
  maps validation failures to 400 instead of 500.
- `jto` playground: the clipboard write starts synchronously inside the
  click (promise-payload `ClipboardItem`), so the browser authorizes it
  while the gesture is live and the payload resolves when the fetch lands;
  a denied write falls back to a dialog with the JSON and its own Copy
  button. The menu item is enabled from the editor's active document (works
  before the first Run, themes excluded) and explains itself with a tooltip
  when no document is open.
