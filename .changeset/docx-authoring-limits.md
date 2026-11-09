---
'@json-to-office/shared-docx': minor
'@json-to-office/core-docx': patch
'@json-to-office/json-to-docx': patch
'@json-to-office/mcp-server': patch
---

DOCX authoring fixes. A `list` now accepts `footnotes` and `endnotes`, declared once for the whole list, so a `[^id]` marker can sit in any item — the compiler already handled them, only validation refused them. A paragraph whose text starts `1.<tab>` is no longer turned into a markdown list: only spaces separate a markdown marker from its text, so a paragraph numbered by hand against a tab stop keeps its own number and formatting; and a paragraph that is a markdown list now passes its `font`, `keepNext` and `keepLines` on to the items instead of dropping them. Braces are a `{PLACEHOLDER}` only around an identifier name (`{PAGE}`, `{SEQ:figure}`): text such as `{0, 1}` stays plain prose, so note markers and links in the same paragraph keep working.
