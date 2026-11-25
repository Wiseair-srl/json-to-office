---
'@json-to-office/mcp-server': patch
'@json-to-office/core-docx': patch
'@json-to-office/core-pptx': patch
---

Fix high-severity advisories in runtime dependencies: bump `@modelcontextprotocol/server` to 2.4.0 (cross-client message delivery, unbounded request size), `adm-zip` to 0.6.1 (decompression bombs, SUID bits preserved on extract) and `probe-image-size` to 7.5.0 (SVG parser DoS). Pin the transitive `fast-uri` 3.1.9, `image-size` 2.1.0, `lodash` 4.18.1 and `zod` 4.6.7.
