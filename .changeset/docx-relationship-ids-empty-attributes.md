---
'@json-to-office/core-docx': patch
---

A hyperlink after an image in the same part no longer ships a dangling
relationship id, which Word reports as a damaged file. Package finalization now
renames relationship ids by attribute, so the empty attributes docx.js writes
on every drawing can no longer put a reference and its relationship out of
step.
