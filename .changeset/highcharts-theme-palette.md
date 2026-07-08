---
'@json-to-office/core-pptx': minor
'@json-to-office/core-docx': minor
---

feat(docx,pptx): highcharts charts follow the document theme by default

The `highcharts` component forwarded its config verbatim, so charts with no explicit `colors` rendered in the Highcharts default palette (blue-first) regardless of theme. When `options.colors` is absent, the renderer now injects the theme palette — pptx uses the same token list as the native `chart` component (primary, secondary, accent, accent4-6); docx uses primary/secondary/accent. Explicit `colors` always wins, so existing configs that set colors are unchanged.
