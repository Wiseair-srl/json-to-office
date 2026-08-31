---
'@json-to-office/mcp-server': patch
---

Serialize the durable side of MCP workspaces, so concurrent tool calls cannot
undo each other (follow-up to #290, shipped in 1.8.0).

Tool calls are independent async tasks and agents pipeline them, which left two
orderings broken. A `jto_workspace_close` that deleted the directory while a
`jto_workspace_patch` was still writing could have the write recreate it, so a
workspace the agent had been told was destroyed came back on the next use of
the handle. And two workspaces opened at once each counted the root before
either had created its directory, so both saw room under `maxWorkspaces` — and
one could delete the other's half-written directory, which sorts stalest
precisely because its metadata is not there yet.

Every durable operation for a connection now runs through one queue, and a
close performs its delete and its eviction in a single critical section. A
write that reaches the front of the queue after its workspace is gone declines
to recreate it and reports `persisted: false`, rather than claiming durability
for a revision that was never written. The queue is root-scoped rather than
per-handle on purpose: the count-then-prune sequence is about the root, so a
per-handle lock would not have covered it.

Also fixes a hazard found while tracing those: rehydrating a workspace deleted
the whole directory whenever the head revision file was missing, which a
concurrent prune causes benignly — a read that picked up revision N's metadata
a moment before a save committed N+1 and pruned N. It now re-reads the metadata
before treating a directory as torn.
