---
'@json-to-office/core-docx': minor
'@json-to-office/json-to-docx': minor
'@json-to-office/shared-docx': minor
---

Bump the `docx` rendering backend from 9.5.1 to 9.7.1 (six releases, ~11
months). The pin stays exact in `pnpm.overrides` and in every peer/dependency
declaration.

Package-level consequences of the upgrade, verified against the full document
corpus:

- Every document now carries a `word/endnotes.xml` part plus its relationship
  and content-type override, and `styles.xml` gains docx's default
  `EndnoteReference` / `EndnoteText` / `EndnoteTextChar` styles. Relationship
  ids shift by one as a result.
- docx serializes some attributes in a different order than 9.5.1 (for example
  `w:spacing`, `w:compatSetting`) — semantically identical output, but a reason
  no downstream code should pattern-match OOXML on attribute position.

Verified locally: clean build, typecheck, lint, unchanged test counts, all seven
corpus documents generate with unique `wp:docPr` ids, structurally valid
packages (well-formed parts, resolvable relationships, complete content types),
and LibreOffice PDF rasters unchanged apart from that renderer's own
page-to-page nondeterminism.
