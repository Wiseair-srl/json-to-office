---
'@json-to-office/jto-ops': minor
'@json-to-office/jto-cli': patch
---

Extract the host operations layer into `@json-to-office/jto-ops`: format adapters, the LibreOffice pptx rasterizer and the platform font stagers now live in a package with no terminal dependencies, so hosts without a UI can use them without pulling in ink, react, commander or chalk. `@json-to-office/jto-cli` re-exports every moved symbol at the same name, so its API is unchanged.
