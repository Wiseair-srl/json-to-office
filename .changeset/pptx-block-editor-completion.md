---
'@json-to-office/shared': minor
'@json-to-office/shared-pptx': minor
'@json-to-office/jto': minor
'@json-to-office/jto-cli': patch
'@json-to-office/mcp-server': patch
---

PPTX blocks in the editor. The exported presentation schema names each renderer's component definition stably, derives binding-aware block-body completion from it (as the DOCX export does), lays versioned plugin branches flat so the if/then dispatch sees them, and dispatches the root on `renderer` so diagnostics come from the profile the deck names. Every PPTX schema producer routes through `@json-to-office/shared-pptx`.

The playground completes block invocations against the document being edited: `ref` offers the defined names, `slots` the selected block's slots with descriptions, defaults and constraints, a component slot the renderer's slide content, and invalid slots, bindings and smuggled placement are flagged inline. Reference blocks from every discovered document (`GET /api/discovery/blocks`) are offered as snippets that insert the definition and its dependencies with the invocation. The AI assistant's PPTX prompts are rewritten around blocks and carry the reference catalog; the chat scope `templates` becomes `blocks`. `@json-to-office/shared` gains `applyDocumentBlocksToSchema`, `blockInvocationExample`, `blockDependencies` and `blockReferencesFromDocument`.
