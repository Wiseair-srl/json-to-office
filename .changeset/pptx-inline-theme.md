---
'@json-to-office/shared-pptx': minor
'@json-to-office/core-pptx': minor
---

feat(pptx): `props.theme` accepts an inline theme config object

A presentation can now embed its theme directly (`props.theme: { name, colors, fonts, defaults, ... }`) instead of naming a built-in or `--theme-path` theme, keeping the document fully self-contained. Both generators normalize the inline object to a named customThemes entry, so font-mode scoping and name-keyed theme re-resolution work unchanged. Validation checks the inline object against `ThemeConfigSchema`.
