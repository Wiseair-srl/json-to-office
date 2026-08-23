---
'@json-to-office/shared-docx': patch
'@json-to-office/shared': patch
---

Fix the exported DOCX schema applying one renderer's rules to the other

The exported schema's recursive component definition was named
`ComponentDefinition` in **both** renderer branches, and the export pass keys
`definitions` by that name with a plain overwrite — so the last branch walked,
`office-open`, answered for both. Every position that reaches components
through that definition (section `props.header`/`props.footer`, table
`props.columns[].cells[].content`, `componentDefaults.section.header`) got the
`office-open` view whatever the document's `renderer` said, in both directions:
a `docxjs` threaded comment in a section header was rejected, and a
`renderMode: "native"` visual under `docxjs` was accepted. Positions reached
through a branch's own narrowed child union — a direct child of `docx` or of
`section` — were always right, which is what made it look local: the same
`visual` was refused in a section body and accepted in that section's header.

The runtime validator was correct throughout (`collectDocxRendererErrors` walks
the real document), so no bad document ever shipped; the cost was
schema-driven editors and `jto docx validate --schema` showing the other
renderer's diagnostics.

The definition is now named per renderer — `ComponentDefinition_docxjs` and
`ComponentDefinition_office-open` — and the `$ref` fix-up passes resolve a bare
reference against whatever was actually hoisted rather than one hard-coded
name. Anything reading `definitions.ComponentDefinition` out of the exported
DOCX schema should use `docxComponentDefinitionName(renderer)`, newly exported
from `@json-to-office/shared-docx`.

The second definition roughly doubles that part of the file: pretty-printed
`schemas/document.schema.json` goes from 8.7 MB to 12.2 MB, and Ajv's compile
from ~3.1 s to ~4.3 s. Nesting depth — what decides whether Ajv overflows V8's
stack — is unchanged, because the second definition sits beside the first
rather than inside it.

Also fixes the exported **theme** schema, which did not compile at all. The
same fix-up pass rewrote every untyped array item into a `$ref` at the root
definition name whether or not such a definition existed. `componentDefaults`
is shared between the document and theme schemas, and its `section.header` and
`section.footer` hold components — but only the document schema carries a
component definition to point them at, so `theme.schema.json` shipped with an
unresolvable `#/definitions/ComponentDefinition`, and Ajv refuses to compile a
schema over one. Every theme validated against the shipped schema failed on the
schema itself, whatever the theme said. With nothing to point at, the item now
stays untyped. The CLI's own `--type theme` was never affected: it validates
against TypeBox, not the exported schema.
