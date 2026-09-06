---
'@json-to-office/core-docx': patch
'@json-to-office/core-pptx': patch
'@json-to-office/jto': patch
---

An unreachable Highcharts export server is reported as what it is. Both cores tag the error with `code: 'SERVICE_UNAVAILABLE'`, and the playground's generate route answers 503 with the message that says how to start the server — before, the playground showed "Internal server error during document generation" while the log alone carried the fix.
