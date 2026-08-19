---
'@json-to-office/core-docx': patch
---

Emit TOC level styles under the canonical `TOC1`..`TOC6` ids.

They were namespaced as `JTD_TOC1`..`JTD_TOC6` defensively, but docx hardcodes
`w:pStyle w:val="TOC{level}"` when it writes cached TOC entries, so the
namespaced ids would leave every cached entry unstyled. docx's own default
styles define no TOC id, so the collision the prefix guarded against does not
exist. Display names (`TOC 1`..`TOC 6`) are unchanged.
