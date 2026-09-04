---
'@json-to-office/mcp-server': patch
---

An assisted run now records what the skill ships and the agent never got.

`json-to-office` 3.2.0 turns out to differ from 3.1.0 in exactly one way: it adds a 4 MB bundled template library, which its own workflow says every document starts from. The prose — `SKILL.md` and the taste and reference documents — is the same eleven files, 80 KB to 82 KB.

That matters for how the assisted baseline is read. With no file tools the agent gets the skill's guidance and cannot open its templates or run its scripts, so the run measures the ceiling of what the skill _says_, not of what it _does_. For this programme that is arguably the right comparison — the templates are already in the server since #322, and the thing being moved into the product is the taste — but it is a distinction the number cannot carry on its own. The loader now counts the files and bytes it left out, the manifest records them as `skillExcluded`, and the run prints the count with the reason.
