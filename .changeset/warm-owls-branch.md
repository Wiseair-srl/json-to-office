---
'@json-to-office/mcp-server': patch
---

Prefix core generation-warning codes into the published `W_` namespace.

The cores raise warnings under bare names (`FONT_UNRESOLVED`, `CHART_NO_DATA`),
and `jto_generate` promoted them to a diagnostic's `code` verbatim — so
`code.startsWith('W_')`, the test that tells an agent a diagnostic does not
block, was false for the one class of diagnostic that never does. The codeless
fallback was worse: it read `E_GENERATION_WARNING`, an `E_` prefix on something
that had not stopped the render, and a code the README never listed. Warnings
now arrive as `W_FONT_UNRESOLVED` and friends, or `W_GENERATION` when the core
named nothing, with the core's own spelling kept on `context.code`.
