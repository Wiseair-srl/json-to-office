---
'@json-to-office/shared-docx': minor
'@json-to-office/shared-pptx': minor
'@json-to-office/jto': patch
---

feat(schema): per-container narrowed children validation for DOCX and PPTX

Each container component now declares its `allowedChildren`, and the schema
generator builds per-container children unions instead of one flat recursive
union. Monaco immediately flags invalid nesting (e.g. heading inside docx).

Also skips auto-builds when JSON is syntactically invalid or has schema
validation errors, preventing wasted server roundtrips during typing.
