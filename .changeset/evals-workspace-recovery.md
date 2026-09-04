---
'@json-to-office/mcp-server': patch
---

The design-evals harness scored successful runs as failures.

An agent that authors through a workspace handle — which is what the server's own instructions tell it to do — generated its document, and the harness then could not find it. It made a temporary workspace directory to read the final document out of, but built the server's environment by copying `JTO_WORKSPACE_DIR` from its own, where it is normally unset. So the server kept workspaces in memory while the harness looked for them on disk. Two real sessions in the first smoke run — 19 and 16 turns each, both ending in a successful `jto_generate` — came back as "the session ended without generating a document".

The server is now told the directory the harness will read, and an ambient `JTO_WORKSPACE_DIR` no longer overrides the run's own.

The reporting is fixed too, which matters more than the wiring. A session that generated nothing is an authoring failure and a real product result; a session whose document the harness could not recover is a measurement failure. They now read differently, and the second is prefixed `HARNESS:` — because the runs it hits hardest are the ones following the recommended path, and a baseline that silently penalised workspace authoring would have looked like a product problem for as long as anyone believed it.
