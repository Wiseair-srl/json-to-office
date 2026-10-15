---
'@json-to-office/jto': patch
---

Dev server: `kind:"file"` font sources in a discovered document or its theme now resolve against the document's directory instead of the server's cwd, so they reach the preview and embed in `embed` export mode.
