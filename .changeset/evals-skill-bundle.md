---
'@json-to-office/mcp-server': patch
---

The assisted eval run would have measured a fifth of the skill.

`--skill` read one file and appended it to the system prompt. A skill is not a file: `json-to-office` 3.1.0 is an 18 KB `SKILL.md` plus 62 KB of taste and reference documents it refers to — typography, layout, chart design, tables, gotchas, two cheatsheets — which the agent reads on demand. Loading only the first would have captured the workflow and none of the taste, and the assisted run is the programme's _ceiling_: understating a ceiling makes every later phase look better than it is, which is the one direction an eval must never be wrong in.

`--skill` now takes the skill's directory and inlines the bundle, `SKILL.md` first and each document tagged with its path. That is an approximation — real skill loading is progressive, and the agent decides what to open — so the manifest records `skillMode`, along with the skill's name, version and file list, and a single file still works but is recorded as `file` and warns. The manifest hashes the whole bundle rather than one document.

Cold runs now also set `skills: []` explicitly. `tools: []` had already removed the Skill tool so nothing could load one, and the recorded baseline is sound — but the SDK is explicit that omitting the option is "not skills off", and a baseline should not rest on one setting happening to imply another.
