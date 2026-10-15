---
'@json-to-office/core-docx': patch
---

Relative `kind:"file"` font sources now resolve against the render's `baseDir` when `fonts.baseDir` is not set, as relative image paths do, instead of against `process.cwd()`. An explicit `fonts.baseDir` still wins.
