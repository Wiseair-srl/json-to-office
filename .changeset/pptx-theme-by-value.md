---
'@json-to-office/core-pptx': minor
---

Hand the resolved theme to `processPresentation` by value.

`processPresentation` used to re-resolve the theme a third time, by name,
from `props.theme` — which forced both generation prologues to rewrite
`props.theme` to a scoped synthetic name and inject the resolved theme
into `customThemes` under it, and to flatten inline theme objects into
generated named entries. `GenerationOptions.theme` now carries the
resolved theme directly; the rewrite/injection dance is deleted and a
document with an inline theme round-trips with `props.theme` exactly as
authored. The name/inline lookup remains as the fallback for direct
`processPresentation` callers.

Render-neutral: all 3 stock templates (inline themes) byte-identical via
both entry points.
