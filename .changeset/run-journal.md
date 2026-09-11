---
'@json-to-office/mcp-server': minor
---

**`JTO_MCP_JOURNAL` records a measured session (#422).** Claude Desktop's own log names each `tools/call` and none of its arguments, so a Desktop session could not be compared with a headless run: nothing said how many repairs it took, whether it previewed, or which revision the delivered file came from. With the variable set, the server appends a session line per connection and one JSON line per tool call — tool, order, duration, the options the agent chose, documents as a digest and size, patches as operations and pointers, the result's identity (handle, revision, artifact path and size) and its diagnostic codes — and keeps the exact document each successful `jto_generate` delivered in `<file>.documents/`, read from the generating revision. Document text never reaches the journal line itself. Off by default; a journal that cannot be written never fails a tool call.
