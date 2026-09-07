---
'@json-to-office/jto-ops': patch
'@json-to-office/core-docx': patch
---

The rendered pass now reports a docx page whose only words are its running head or footer as an empty page (`W_QUALITY_RENDERED_EMPTY_PAGE` with `context.kind: "chrome-only"`; a wordless page carries `kind: "blank"`). Before, the repeated chrome counted as content and a stray trailing page under a running head passed clean. Decks keep the old behaviour: a slide with any word, its slide number included, is not empty. The `client-report` profile raises the rule to `warning`, since the report blocks put every figure in a captioned block.
