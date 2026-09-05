---
'@json-to-office/mcp-server': patch
---

Require a matching successful `jto_generate` response with an artifact before an eval run counts as completed. Record tool results, and recover the workspace revision named by generation rather than a later edited head.

Sum author usage, tool calls, turns and contamination across retries, retaining failed-session usage and attempt transcripts. Interrupted attempts without final usage mark `cost.usageComplete: false`; their recorded costs are a lower bound.
