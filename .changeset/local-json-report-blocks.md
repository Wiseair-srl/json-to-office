---
'@json-to-office/shared': minor
'@json-to-office/shared-docx': major
'@json-to-office/core-docx': major
'@json-to-office/mcp-server': major
'@json-to-office/jto': major
---

Replace named DOCX report components with document-local JSON blocks. Definitions live in `props.blocks`; invoke with `name: "block"`, `props.ref` and `props.slots`. Remove the four old component schemas and composition compilers without aliases. Support typed slots, bounded repetition, optional regions, theme bindings, section effects and registered plugin composition with authored source maps.

Ship complete playground examples and a derived MCP authoring-reference catalog. Workspace inspection exposes local definitions, derived slot schemas and fill pointers. Catalog names are never implicit runtime blocks. The report examples deliberately change typography/spacing; content budgets now fail validation before rendering. PPTX migration follows separately.
