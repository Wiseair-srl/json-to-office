---
'@json-to-office/core-pptx': minor
'@json-to-office/core-docx': minor
'@json-to-office/quality': minor
'@json-to-office/shared': minor
'@json-to-office/shared-pptx': patch
'@json-to-office/shared-docx': patch
'@json-to-office/jto-ops': minor
'@json-to-office/jto-cli': minor
'@json-to-office/mcp-server': minor
'@json-to-office/jto': patch
---

Design quality becomes a first-class pipeline (#216, #218).

Adds autonomous `@json-to-office/quality`: facts/rules/profiles/policy,
certainty and evidence, suppressions, budgets, rule isolation, rich diagnostics,
and explicit gates. Shared keeps compatibility re-exports.

DOCX/PPTX cores own preparation, authored-path provenance, facts, built-in rule
packs, and five initial document-class profiles. Official adapters reuse one
opaque `PreparedDocument` for analysis and rendering. Legacy `collect*Findings`
and optional `qualityCheck` remain compatible.

CLI, MCP, HTTP, cache hits, and playground generation preserve rich quality
diagnostics. Advisory remains default; profile/policy can block validation or
generation before rendering. The executable 15-case reference corpus pins
poor/professional/excellent verdicts and authored digests; stock templates stay
warning-clean.
