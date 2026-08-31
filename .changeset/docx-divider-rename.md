---
'@json-to-office/core-docx': minor
'@json-to-office/shared-docx': minor
'@json-to-office/mcp-server': patch
---

Rename the `rule` component to `divider`.

`rule` was the typographic term and the word #291 used, but this codebase
already spends it: `QualityRule`, rule packs, rule ids, `docx/line-box`, and
OOXML's own `lineRule` sits in the very property the component sets. Prose
about the component and prose about the lint were a paragraph apart and read
the same. `divider` is what component libraries settle on for the same reason.

Nothing but the authored name changes — same props, same paragraph border, same
collapsed line box, byte-identical output, and the corpus goldens did not move.
`W_QUALITY_LINE_BOX_COLLAPSE` now points at `"divider"`.

**Breaking for anyone who wrote `{ "name": "rule" }` against 1.9.0**, which
shipped the component under its old name. There is no alias: keeping one would
enshrine the ambiguity the rename exists to remove, and the name was published
for a matter of minutes. Rename the node; nothing else moves.
