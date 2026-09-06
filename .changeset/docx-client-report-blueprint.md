---
'@json-to-office/shared': minor
'@json-to-office/shared-docx': minor
'@json-to-office/shared-pptx': minor
'@json-to-office/core-docx': minor
'@json-to-office/core-pptx': minor
'@json-to-office/jto-ops': patch
'@json-to-office/jto': minor
'@json-to-office/mcp-server': minor
---

Blueprints: document archetypes as data. A blueprint names a recommended theme, the quality profile that judges the result, the playground template whose JSON blocks it invokes, and structural variants whose every slot holds a `{{…}}` scaffold marker carrying the guidance for filling it. The first is `client-report` for DOCX, with a `data-heavy` and a `narrative` variant; `instantiateDocxBlueprint` turns one into a schema- and semantic-valid document that carries the definitions it invokes and their dependencies, plus a fill map listing every marker with its pointer, kind, budget and guidance. `jto_discover` lists the bundled blueprints as summaries.

Profiles, not themes, own required chrome. Two DOCX rules, off by default: `docx/required-chrome` reports a block slot with a role the profile requires — a takeaway, a source — left empty, at the slot; `docx/running-head` reports a section from `fromSection` on without the header, footer or page-number field the profile expects. The new `client-report` profile turns both on and promotes heading skips to warnings. Both formats gain an optional root `qualityProfile`: the shipped profile validation judges the document by when the caller names none, a caller's profile winning and an unknown name falling back to the default — so a scaffold is judged against its archetype's bar from the first `jto_validate`.

Fixes: an authored invocation was recorded twice when its definition invoked another block, doubling its slot-budget facts; a `metadata.date` the Date parser rejects — a scaffold marker, "Q3 2026" — no longer fails generation and leaves the package timestamps to the generation date.
