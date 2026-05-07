---
'@json-to-office/core-docx': patch
'@json-to-office/json-to-docx': patch
---

chore: drop highcharts-export-server peerDependency — server is only called over HTTP, no runtime import; removes install-time approve-build warning for consumers
