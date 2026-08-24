---
'@json-to-office/mcp-server': minor
---

Add `@json-to-office/mcp-server`: a local stdio Model Context Protocol server, runnable with `pnpm dlx @json-to-office/mcp-server` or `npx -y @json-to-office/mcp-server`, that lets an agent author, inspect, validate, preview, diff and generate `.docx` and `.pptx` as JSON.

Tools: `jto_info` (versions, formats and their renderer ids, output root, size limits, and whether the optional preview dependencies are installed); `jto_discover` and `jto_describe_component` for progressive discovery of components, renderer profiles, themes and starters; `jto_validate`, `jto_generate` and `jto_docx_diff` for the authoring loop; `jto_preview` to render selected pages to PNG; and `jto_workspace_*` for connection-scoped documents an agent edits with RFC 6902 patches instead of resending the whole tree. The same catalogues are also published as `jto://` MCP resources for clients that read them.

Every document-taking tool accepts either inline JSON or `{handle, revision?}`, with identical behaviour. Files are written only under a configured output root (`--output-dir`, `JTO_MCP_OUTPUT_DIR`, else a per-connection temp directory); document defects come back as path-addressed diagnostics rather than protocol errors; stdout carries protocol frames only. `jto_preview` needs LibreOffice and poppler on the host and degrades to a structured, actionable error when either is missing.
