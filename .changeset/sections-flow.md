---
'@json-to-office/core-docx': minor
'@json-to-office/jto': minor
'@json-to-office/mcp-server': minor
---

Sections under one running head now continue on the page. A section that inherits a block's header and footer no longer inherits its page break; only the declaring section (the first body section, after the cover) starts a new page, and an authored `pageBreak: true` still breaks. The `running-head` block in `client-report-blocks.docx.json` heads every page with the document title alone and drops its `tracker` slot; `section-opener` drops its `tracker` slot and section effect (the tracker was only ever read by the header, which can change only at a page boundary and so forced one section per page). The `client-report` blueprint no longer scaffolds `{{Tracker}}` markers.
