---
'@json-to-office/shared-docx': patch
---

fix(validate): recognize `docx` (and any registered root) in deep validator

The CLI `validate` command emitted false-negatives — `root: Invalid component
configuration for 'docx'` plus `/name: Unknown component "docx"` — on documents
that `generate` accepts cleanly. The deep validator's component-schema lookup
was hardcoded with a stale `report` entry and no `docx` entry, so the root
`name: "docx"` was reported as unknown.

The lookup table now comes from `STANDARD_COMPONENTS_REGISTRY` (the single
source of truth), and the comprehensive validator strips TypeBox's generic
discriminated-union catch-all so it never appears alongside the precise,
path-aware diagnostics the deep validator already produces.
