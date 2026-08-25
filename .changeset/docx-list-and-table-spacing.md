---
'@json-to-office/core-docx': patch
'@json-to-office/shared-docx': patch
---

Fix two DOCX layout defects that only show up in a rendered page.

**A list marker sat outside the page margin.** Every bundled theme set
`componentDefaults.list.indent: 3`. That field is points, so level 0 compiled to
`w:ind w:left="60" w:hanging="360"` — a marker 300 twips to the _left_ of the text
margin, outdented past the body text it labels. The themes no longer state it, so
the per-level default applies: 720/360, which is Word's own. `IndentSchema` now
documents its unit, since the neighbouring `ParagraphIndentSchema` is twips and
neither said so — which is how the value came to be written in the first place.

**Whatever followed a table drew on its bottom border.** OOXML gives a table no
space-after; the property does not exist. A heading was fine because its style
carries space above, but a body paragraph and a list item both landed on the rule.
A body block directly under a table now gets 120 twips above it. Styles that
already contribute their own space are left alone — topping up a `Heading2` would
make it less separated, not more — and so is an author who stated a value.

For that last part to hold, list spacing had to start treating zero as a value.
`itemSpacing` tested `before`, `after` and `item` for truthiness, so
`spacing: { before: 0 }` produced no `beforeTwips` at all and was
indistinguishable from silence — the new rule would have handed such a list the
120 twips it explicitly asked not to have. All three are read against `undefined`
now, which also makes `spacing: { after: 0 }` mean what it says instead of
falling through to `item`; the corpus case named `component-defaults-instance-wins`
had that exact shape and the instance was not winning.
