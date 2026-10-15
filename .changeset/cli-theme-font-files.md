---
'@json-to-office/jto-ops': patch
'@json-to-office/jto-cli': patch
---

Theme files: relative `kind:"file"` font sources in a theme loaded with `--theme-path` (or `--theme <file>.json`) now resolve against the theme file's own directory, so a theme that ships its fonts beside it works from any cwd. `jto generate` also forwards the document directory as `fonts.baseDir`, so a document's own relative font files no longer resolve against the cwd.
