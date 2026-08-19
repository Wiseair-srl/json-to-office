---
'@json-to-office/core-docx': minor
'@json-to-office/shared-docx': minor
---

Write TOC fields with their entries already cached, so a headless PDF renders a
real table of contents.

`updateFields: true` asks Word to repopulate every TOC on open, and Word
obliges — but headless LibreOffice does not, so a TOC field with no cached
content exported as just the word "Contents". The rasterizer path goes through
soffice, so this was the case that bit.

A new pre-pass collects the entries before rendering and `renderTocComponent`
passes them to docx as `cachedEntries`. The collector walks the layout the way
the renderer does:

- headings, including those nested in a `text-box`;
- paragraphs whose `themeStyle` a TOC maps through `props.styles` — Word
  includes those via the `\t` switch, so a heading-only pass would have made the
  cached entries disagree with Word's own refresh;
- never headers or footers (a heading there renders as nothing);
- disabled subtrees pruned.

Entries are filtered per TOC by depth range, style mapping and — for a
section-scoped TOC — the section bookmark. Titles have their markdown
decorators stripped the same way `createHeading` does. Page numbers and entry
hyperlinks are deliberately omitted: nothing in generation paginates, and Word
fills real numbers in on refresh.

Existing TOC-bearing documents change from a two-empty-paragraph field block to
N styled entries.
