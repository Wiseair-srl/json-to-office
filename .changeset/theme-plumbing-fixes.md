---
'@json-to-office/core-docx': patch
'@json-to-office/shared-pptx': patch
'@json-to-office/jto-ops': patch
---

Three theme-loading defects, all of the same kind: a theme that validates, renders, and quietly is not what the file said.

**DOCX theme layers were deleted between validation and the renderer.** `ensureThemeDefaults` rebuilt the theme from a hand-written literal of the ten root keys it knew about, so everything else the schema allows was dropped — `fontRegistry` and `noProofWords` on every bundled theme and every `--theme-path` render. Nothing failed: the file validated, generation succeeded, and the styling was simply absent, with no error to search for. It now spreads what it was given and backfills defaults after, at the root and inside `fonts`. `theme-round-trip.test.ts` walks `ThemeConfigSchema` and fails the day a property is added and forgotten here, which is the only moment that is cheap to fix. No shipped theme declares either key, so nothing renders differently today — this stops the next layer from vanishing the same way.

**The PPTX theme guard checked nothing.** `isValidThemeConfig` was `typeof data === 'object' && data !== null`: `{}` came back `true`, and the caller carried on with a `ThemeConfigJson` the compiler trusted and could not read. It is now `Value.Check` against the schema, the same contract the DOCX twin has always had.

**A PPTX `--theme-path` file was parsed but never validated.** The DOCX branch calls `loadThemeFromFile`; the PPTX branch did bare `readFileSync` + `JSON.parse` and handed the result to a compiler that reads `theme.defaults.fontSize` unguarded — so a malformed theme surfaced as a TypeError in the IR instead of a diagnostic naming the field. It now goes through `validatePptxTheme` and refuses with the first three errors, keeping the document's own theme.
