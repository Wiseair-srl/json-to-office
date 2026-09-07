---
'@json-to-office/jto-ops': minor
'@json-to-office/mcp-server': minor
'@json-to-office/core-docx': minor
'@json-to-office/design-evals': patch
---

Rendered pass (#344) under the quality contract. The pass is now a rule pack (`RENDERED_QUALITY_RULES`) run through the quality engine, so profiles, suppressions, severity overrides and gates apply to rendered findings; `jto_preview` takes the same `quality` option as `jto_validate`, judges by the document's declared profile or the format default otherwise, and reports `rendered.suppressed`, `rendered.blocked` and `rendered.profileId`. The design guide lists the rendered rules. A rendered preview prepares the document once and both generates from and maps through that prepared model. The DOCX text inventory covers a contents field (optional entries where it renders, scoped and depth-limited as the field is) and a native chart's title and axis titles, so neither steals a heading's first occurrence. A labelled mapping corpus (duplicates, contents page, ligatures, chrome around a split paragraph, a declared font that cannot load, chart titles, a truncated frame) scores mapping precision and recall at 1.0 against the ≥0.95 / ≥0.90 targets.
