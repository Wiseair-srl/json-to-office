---
'@json-to-office/quality': patch
'@json-to-office/jto-ops': patch
'@json-to-office/core-docx': patch
'@json-to-office/mcp-server': patch
---

The rendered pass gains `rendered/page-underfilled` (`W_QUALITY_RENDERED_PAGE_UNDERFILLED`): a docx page, other than the first and the last, whose ink stops less than halfway down the body area before the next page begins, mapped to the section that owns the page with the measured share on `context.fill`. Ink, not words, so a chart or a table fills a page. The preview now samples each page in grayscale at 24 dpi with pdftoppm and caches the row profile beside the text geometry (preview cache version 2). The `client-report` profile reports the rule at `warning`.
