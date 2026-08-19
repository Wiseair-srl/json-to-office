---
'@json-to-office/shared-pptx': minor
'@json-to-office/jto': minor
---

PPTX slides accept `meta.title` — an authoring-only label, symmetric to the
DOCX section `meta.title`: never rendered (generated .pptx is byte-identical
with or without it), surfaced by editors and the playground outline as the
slide's label.

The outline's derived slide labels also got smarter for documents without
explicit labels: template-driven slides now read their `title`/`subtitle`
placeholders (previously such decks labeled as "Slide N"), and multi-line
titles are joined onto one line instead of truncating at the first line
break. All stock pptx templates ship with curated `meta.title` labels where
the derived label was weak or duplicated.
