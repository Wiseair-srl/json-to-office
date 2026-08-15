---
'@json-to-office/core-docx': minor
---

fix(docx): apply theme `componentDefaults` to components written without a `props` key

`resolveComponentDefaults` returned early when a component had no `props` key at all, so theme defaults reached `{"name": "section", "props": {}, …}` but not `{"name": "section", …}`. A missing `props` is now treated as `{}`, and every component picks up its theme defaults regardless of how it was written.

**The root `docx` node no longer crashes without `props`.** `validateDocument` / `validateJsonComponent` accept a propless root, but generation then read `document.props.theme` unguarded and died with `TypeError: Cannot read properties of undefined (reading 'theme')`. Both entry points — `generateDocumentWithCustomThemes` and the plugin builder in `createDocumentGenerator` — now normalise a missing root `props` to `{}` before anything downstream touches it, which also covers the unguarded reads in `processDocument` (`componentDefaults`, `noProofWords`, `trackRevisions`, `language`, `metadata`). This only widens what generates: a root that carries `props` keeps its object identity, so every existing output is byte-for-byte unchanged, and a propless root now produces bytes identical to the same document written with `"props": {}`.

Note that the published DOCX JSON Schema still marks the root's `props` as required, so an editor honouring `$schema` flags a propless root that the library now happily builds. Writing `"props": {}` remains the correct thing to do; reconciling the two layers is a separate change.

**This repaginates existing documents.** A titleless `section` with no `props` key used to miss `componentDefaults.section` and fall back to the built-in `pageBreak: true`, starting a new page. All five bundled themes set `section.pageBreak: false`, so those sections no longer break the page. Write `"props": { "pageBreak": true }` on the section to get the page break back. The same correction applies to every other component with theme defaults (`heading`, `paragraph`, `image`, `statistic`, `table`, `columns`, `list`) — a propless node now inherits them.

The bundled themes also drop five `componentDefaults.table` keys that no renderer ever read and that the theme schema rejects: `borders`, `striped`, `headerBackground`, `headerColor`, and `borderWidth`. All five bundled themes now pass `validateThemeJson`, which they did not before; rendering is unchanged, because nothing consumed those keys. If you copied a bundled theme as a starting point, remove them — the settings that do exist are `componentDefaults.table.headerCellDefaults.backgroundColor` / `.color`, `hideBorders`, and `borderSize`. There is no theme-level row striping.

The same treatment now reaches the document root, and the exported JSON Schema agrees: `props` is marked optional there, so a schema-driven editor no longer flags a propless root that the generator accepts. Only an absent or `undefined` `props` is defaulted — an explicit `null`, `false` or `""` stays as written and is rejected by validation instead of being rewritten into a valid shape.
