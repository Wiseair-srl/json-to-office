---
'@json-to-office/core-docx': patch
---

fix(docx): validate standard nodes emitted by a custom component's render()

Generation validation (default on) only validated the input document, before component expansion. A standard component emitted by a custom component's `render()` was never schema-checked, so a document could generate "successfully" while its `standardDefinition` failed standard-schema validation (e.g. when pasted into the playground).

Each `render()`'s emitted tree is now validated at the boundary with the same gate authored standard components pass through, and the error names the emitting component (`custom component '<name>' emitted invalid output — …`). Honors `validation.enabled` and `validation.allowUnknownFields` like the rest of the pipeline.
