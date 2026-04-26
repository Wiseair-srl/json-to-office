---
'@json-to-office/core-pptx': patch
---

fix(core-pptx): plugin path now honors `props.theme` over constructor default

Plugin-aware presentation generator unconditionally used a constructor-supplied `state.theme` object, shadowing `customThemes[doc.props.theme]`. Playground sessions with any plugin loaded rendered docs with the wrong theme (e.g. `props.theme: "wiseair"` falling back to `themes.minimal`). Resolution now mirrors the non-plugin path and the DOCX side: doc-level theme name wins, customThemes is consulted first, constructor `state.theme` is the fallback only.
