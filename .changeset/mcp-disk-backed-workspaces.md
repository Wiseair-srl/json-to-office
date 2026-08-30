---
'@json-to-office/mcp-server': minor
---

MCP workspaces can now be disk-backed, so a lost client session no longer
destroys the revisions it was holding (#290). Workspaces were memory-only:
`entries`, `tombstones` and every pinned snapshot lived in `Map`s built per
connection, so a host session reset, a client restart or a crash silently
discarded all of it — in the field report this came from, five revisions of
authoring went while the server process itself stayed alive and idle.

Start the server with `--workspace-dir` (or `JTO_MCP_WORKSPACE_DIR`) and each
committed revision is mirrored under that root before the tool answers. Memory
stays the fast path; disk is durability. A reconnecting client calls
`jto_workspace_list`, gets back every handle under the root — including ones
this connection never opened — and reads or patches them as usual, with the
document loaded on demand. The idle TTL still releases memory but no longer
loses anything, and `jto_workspace_close` still destroys the work, on disk too.

Off by default, so nothing changes for a connection that does not configure a
root: handles stay memory-only and end with the connection.

The root is bounded — 32 workspaces (least-recently-updated evicted first), 9
revision files each (the head plus its pins), 16 MiB per revision — and a
revision that cannot be written comes back as a `W_WORKSPACE_NOT_PERSISTED`
warning with the edit applied, so durability degrades loudly rather than
silently. Writes are atomic and ordered so the metadata never names a revision
file that is not there. A `workspace` record gains `persisted`,
`jto_workspace_list` gains `persistence`, and `jto_info.workspaces` gains
`persistent` and `root`.
