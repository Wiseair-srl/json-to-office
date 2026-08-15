---
'@json-to-office/core-docx': minor
'@json-to-office/shared-docx': minor
---

feat(docx): write `props.metadata` into the document properties

`metadata` was accepted, validated, and then dropped: `new Document({…})` was constructed without any core properties, so nothing the author wrote reached the `.docx`. Word showed an empty Properties panel and the fields were invisible to search and DMS indexing.

The generated package now carries them: `title`, `subtitle` → `dc:subject`, `description`, `author` → `dc:creator` and `cp:lastModifiedBy`, `tags` → `cp:keywords`, and `company` plus `version` as `Company` / `Version` entries in `docProps/custom.xml` (Word has no core-property slot for either). Documents that set `metadata` therefore produce different bytes than before, and generation stays deterministic.

**`metadata.created` and `metadata.modified` are removed from the schema.** They could not be honoured: docx stamps `dcterms:created` / `dcterms:modified` with the wall clock and exposes no override, so the values were silently discarded on every build. Because `metadata` is `additionalProperties: false`, a document that still sets them now fails validation with `Document validation failed` instead of being accepted and ignored — the rendered bytes are identical either way. Delete the two keys; set the package timestamps through the `generatedAt` generation option, which is what controls them. `validation.allowUnknownFields: true` strips them if you need a stopgap.

`metadata.date` is unaffected: it drives `{DATE}` / `{DATETIME}` placeholder resolution, not the package timestamps. The schema descriptions now say where each field lands.
