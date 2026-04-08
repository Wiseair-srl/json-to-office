---
'@json-to-office/jto': patch
'@json-to-office/shared-docx': patch
---

feat: use Monaco built-in JSON schema validation for theme editor

Replace custom `validateThemeJson` marker-setting with Monaco's native `onValidate`, add ValidationPanel/StatusBar UI, and tighten theme schemas with `additionalProperties: false`.
