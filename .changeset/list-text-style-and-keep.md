---
'@json-to-office/shared-docx': minor
'@json-to-office/core-docx': minor
---

feat(docx): `list` accepts `font`, `keepNext` and `keepLines`

Styling and hanging indent were not orthogonal. A list's items were built on an empty base run style and carried no keep flags, so a consumer rendering a nested block — a tree of conditions under its heading — had to choose: `list` for the hanging indent but no colour or size, or `paragraph` for the styling but no indent. Inline decorators (`**bold**`, `*italic*`) were the only variation reachable inside an item.

`ListPropsSchema` now carries `font` — the same `Type.Partial(FontDefinitionSchema)` the paragraph uses — plus optional `keepNext` and `keepLines`. The schema is `additionalProperties: false` with validation on by default, so without this the props were rejected before reaching the renderer.

`compileList` resolves the `font` once for the whole list through the same `runFormatting` the paragraph path uses, so a colour token, a size in points, or an italic reads identically either side, and the resolved base is the parse base for both plain items and tracked-change ones. The keep flags are set on every item, not just the first: keeping a list with what introduces it means keeping it whole.

Distinct from a level's `font`, which styles the marker glyph and nothing else — the two compose. Fully additive: a list with no `font` still gets an empty base and no keep flags, and renders byte-for-byte as before.
