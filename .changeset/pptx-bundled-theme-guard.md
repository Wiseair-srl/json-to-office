---
'@json-to-office/core-pptx': patch
---

Adds the bundled-theme schema guard PPTX never had.

DOCX has validated its bundled themes since they shipped dead `componentDefaults.table` properties that no renderer read and the validator rejects. PPTX had no equivalent, and needs one more than DOCX does: its themes are TypeScript object literals rather than JSON files, so nothing ever ran them past `ThemeConfigSchema` — `tsc` checks them against the hand-written `PptxThemeConfig` interface, which is a different thing and has drifted before.

The timing is the point. `ir/compiler.ts` reads `ctx.theme.defaults.fontSize` unguarded, so a theme the schema would have rejected surfaces as a TypeError deep in the compiler rather than as a diagnostic naming the field. Survivable while three hand-written themes are the whole set; not survivable once themes carry type ladders, spacing scales and chrome recipes.

Each theme is validated as a literal and again after a JSON round trip, since `undefined` members vanish on the way and that is how an optional property that is secretly required goes unnoticed. The registry is checked too: `getPptxTheme` falls back to the default on a miss, so a theme whose `name` disagrees with its key is a lookup that silently returns something else wearing the wrong label.
