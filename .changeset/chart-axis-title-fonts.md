---
"@json-to-office/shared": patch
"@json-to-office/core-docx": patch
"@json-to-office/core-pptx": patch
---

Native chart axis titles now state a size, face and colour instead of falling back to Word's and PowerPoint's large built-in defaults. DOCX charts take the theme body font and text colour at up to 10pt, also as the chart-wide text default; PPTX axis titles follow their tick labels and can be overridden with `catAxisTitleFontSize`, `catAxisTitleFontFace`, `catAxisTitleColor`, `catAxisTitleRotate` and the `valAxisTitle*` equivalents.
