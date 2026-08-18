---
'@json-to-office/core-docx': patch
---

Extract the duplicated tab-splitting line-run builder shared by the plain-text and placeholder paths into `buildRunCommonProps` / `buildTextRuns` (textParser), so run-level properties can no longer drift between the two paths. No behavior change; parity now pinned by tests for every run-level prop.
