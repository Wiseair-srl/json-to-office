---
'@json-to-office/jto': patch
---

Disable filesystem tools (Read, Write, Edit, Glob, Grep, Bash, Agent) in AI chat provider to prevent crash when Claude Code autonomously reads large files. Also disable session persistence and improve error detection for oversized requests.
