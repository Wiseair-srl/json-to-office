---
'@json-to-office/mcp-server': patch
---

Two settings the documentation named and the server never read.

The Claude Desktop guide told readers to set `JTO_OUTPUT_DIR` and `JTO_WORKSPACE_DIR`. The server reads `JTO_MCP_OUTPUT_DIR` and `JTO_MCP_WORKSPACE_DIR`. An unknown variable is not an error — it is a setting that silently never applies — so anyone following the guide got durable workspaces and a chosen output directory that quietly did neither.

The design-evals harness had the same names, invented the same way, and paid for it. It makes a workspace directory and reads the agent's final document out of it; with the variable ignored, the server kept workspaces in memory while the harness searched the disk. Every agent that authored through a handle — which is what the server's own instructions tell it to do — was recorded as having generated nothing. The first smoke run threw away two complete sessions of 19 and 16 turns, both ending in a successful `jto_generate`.

Both are corrected, and the harness now imports `OUTPUT_DIR_ENV` and `WORKSPACE_DIR_ENV` from the server rather than spelling them out, because spelling them out is what broke it. Verified by spawning the real server over stdio and watching `meta.json` and `rev-1.json` appear where the harness looks.

A new drift test scans the setup guides for `JTO_*` names and fails on any the source does not read, so documentation cannot invent a setting again.

Separately, the harness now tells the two failures apart. A session that generated nothing is an authoring failure and a real product result; a session whose document it could not recover is its own, and says so with a `HARNESS:` prefix. Conflating them meant the runs following the recommended path were the ones scored worst — which would have read as a product problem for as long as anyone believed the number.
