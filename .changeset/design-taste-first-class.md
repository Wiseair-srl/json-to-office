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
'@json-to-office/jto': minor
---

Design quality becomes a first-class pipeline (#216, #218).

Adds autonomous `@json-to-office/quality`: facts/rules/profiles/policy,
certainty and evidence, suppressions, budgets, rule isolation, rich diagnostics,
and explicit gates.

DOCX/PPTX cores own preparation, authored-path provenance, facts, built-in rule
packs, and five initial document-class profiles. Official adapters reuse one
opaque `PreparedDocument` for analysis and rendering. Core entry points and
format adapters expose the evidence-rich `QualityAnalysis` contract directly.

CLI, MCP, HTTP, cache hits, and playground generation preserve rich quality
diagnostics. Advisory remains default; profile/policy can block validation or
generation before rendering. The executable 15-case reference corpus pins
poor/professional/excellent verdicts and authored digests; stock templates stay
warning-clean.

Estimator thresholds are calibrated against rendered ground truth: a new
harness (jto-ops `test:ground-truth`) renders mutated stock templates through
LibreOffice and scores predictions against exact PDF word geometry
(`extractPdfTextGeometry`, exported from jto-ops). Calibration admits only
top-aligned, unrotated boxes whose bottom-edge spill is directly comparable.
The pptx text-fit `characterWidthFactor` moves 0.45 → 0.46 (the measured
zero-false-warning optimum), pptx text facts gain box geometry, alignment,
rotation, and compiler-aligned `autoFit`, and one stock template's undersized
content slot — a measured 25pt real overflow — is fixed. Deterministic
diagnostics now carry ready-made RFC 6902 `fixes`: fully specified table column
rescaling, heading level repair, minimum font floor, and a fitting `fontSize`
for estimated overflows when a size allowed by the active profile/policy fits.
