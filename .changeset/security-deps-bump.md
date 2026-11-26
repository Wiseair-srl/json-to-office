---
'@json-to-office/mcp-server': patch
'@json-to-office/core-docx': patch
'@json-to-office/core-pptx': patch
---

Fix high-severity advisories in runtime dependencies: bump `@modelcontextprotocol/server` to 2.4.0 (cross-client message delivery, unbounded request size), `adm-zip` to 0.6.1 (decompression bombs, SUID bits preserved on extract) and `probe-image-size` to 7.5.0 (SVG parser DoS). A fresh install also resolves the patched transitive `fast-uri` (≥3.1.9), `lodash` (≥4.18.0) and `zod` (≥4.6.6), which their parents' ranges allow.

Known limitation: `pptxgenjs@4.0.1`, the latest release, still requires `image-size@^1.2.1`, so installs of `@json-to-office/core-pptx` (and of `@json-to-office/mcp-server` through it) resolve an `image-size` 1.x covered by GHSA-w3rx-r6r6-pgpr and GHSA-5p2g-fcmc-qvqq. No patched 1.x exists. pptxgenjs never imports `image-size`, so the vulnerable parsers are installed but not loaded. The repository's own `image-size` 2.1.0 override applies only inside this workspace, not to consumers.
