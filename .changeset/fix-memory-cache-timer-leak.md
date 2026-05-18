---
'@json-to-office/shared': patch
---

fix(shared): unref `MemoryCache` cleanup timer so the CLI exits promptly

The component-cache cleanup `setInterval` (5-minute period) kept the Node
event loop alive after work finished, making `jto-cli docx generate` hang
for up to 5 minutes per run. The interval is now `.unref()`-ed so it no
longer blocks process exit.
