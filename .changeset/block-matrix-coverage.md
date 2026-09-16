---
'@json-to-office/shared': minor
'@json-to-office/shared-docx': minor
'@json-to-office/shared-pptx': minor
'@json-to-office/jto-ops': minor
'@json-to-office/jto': patch
'@json-to-office/mcp-server': patch
---

The block coverage matrix spans both formats and every template (#343).

- `jto-ops`:
  - `buildMatrixInventory` lists every JSON block definition the playground templates embed, using the extraction `jto://blocks` publishes. For each definition it gives the themes, canvases, fonts and slot edges it is supported on, and a reason for each one it is not. `generateMatrixCases` builds boundary reports and decks from it.
  - The rendered text matcher finds a report line the reading order took for a table, such as a memo header's tab-aligned "Date — value", by reading the rows as they lie.
- Validation reports two defects in a definition at the `ref` that causes them, instead of only at expansion and only at a pointer into the expanded tree:

  - a body that names a block the document does not define (`block_unknown_reference`);
  - a definition that invokes itself on every expansion (`block_expansion_limit`).

  Validation also names what replaced removed syntax: a deck's slide `templates`, `template`, `placeholders` and `layout` point to JSON blocks, and a component named like a block, or a block invocation that uses `name` instead of `ref`, is told how to invoke the block.

- The consulting deck blocks now span the theme's safe area horizontally, so they stay inside it on 4:3 as well. Their budgets now match what the house sizes hold:
  - action titles: 17 words, down from 24;
  - the statement assertion: 11 words, down from 14.
