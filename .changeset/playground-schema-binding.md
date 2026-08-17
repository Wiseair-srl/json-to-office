---
'@json-to-office/shared-docx': patch
'@json-to-office/jto': patch
---

Fix the playground JSON editor having no schema bound to its models: the
editor now builds a model URI carrying the format's double extension so it
matches the schema's `fileMatch`, restoring schema-driven completions,
validation and hovers. Root `children` in the exported document schema also
now accepts `section` plus everything a section accepts, matching what the
validator and generator have always taken.
