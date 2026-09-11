---
'@json-to-office/shared-docx': minor
'@json-to-office/shared': patch
'@json-to-office/mcp-server': patch
'@json-to-office/jto': patch
---

A `text-box` holds what a section holds. The published DOCX schema narrowed it to headings, paragraphs, images and dividers — the renderer compiles the box as a one-cell table and takes any flow content, so the cover block's metadata band (a table inside a floating box) built and rendered while the editor and the published schema flagged `table` as not accepted.

Flow content — what a section body holds — is now one shared recursive definition (`FlowContent_<renderer>`) that `section`, `group` and `text-box` reference, instead of a copy inlined per container. That is what lets the containers in flow nest each other (a text-box holding a columns holding a text-box), which the inlining pass could not express and the `group` special case only approximated: inside a group the editor used to report a bad component name twice, once against every component and once against the allowed ones. `columns` keeps its narrower list (everything but another `columns`).

The block-authoring schema no longer loses a component branch that is inlined while it is still being built, which the now-cyclic definition graph exposed.

Two guards: every bundled playground template validates without a marker through the editor's own JSON language service, and every gallery template satisfies the JSON Schema the MCP server publishes.
