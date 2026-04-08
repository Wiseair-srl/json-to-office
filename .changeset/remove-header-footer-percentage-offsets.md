---
'@json-to-office/shared-docx': minor
'@json-to-office/core-docx': minor
'@json-to-office/jto': patch
---

Remove placeholder header/footer component types and exports. Centralize image type detection and ImageRun construction. Support percentage strings (e.g., "50%") for floating position offsets and wrap margins, resolved against page or available dimensions. Fix table cell backgroundColor defaulting to transparent when unset.
