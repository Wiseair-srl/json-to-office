---
'@json-to-office/shared': minor
'@json-to-office/core-pptx': minor
'@json-to-office/core-docx': minor
'@json-to-office/mcp-server': minor
---

The `consulting-deck` blueprint and PPTX scaffolding (#342). `core-pptx` exports `PPTX_BLUEPRINTS`, `pptxBlueprint` and `instantiatePptxBlueprint`; the blueprint's two variants (data-heavy: cover, KPI row, three action-charts, a two-column table, a statement; narrative: cover, a statement, two two-column chart slides, an action-chart, a two-column table, a statement) invoke the five deck blocks of `consulting-deck-blocks.pptx.json` and are judged by the `consulting-deck` profile. What instantiating means — carrying the invoked definitions and their dependencies, listing every `{{…}}` marker with its slot budget — now lives in `shared` (`instantiateBlueprint`, `registerBlueprints`, `slotAt`, `valueAt`); each core keeps only the shape of its root, so a deck's metadata sits under `props` and a document's under `props.metadata`. `jto_scaffold` takes `format: "pptx"`: brief facts fill the deck's `title`, `author` and `company` and the cover's slots; each `##` of an outline fills the next content slide's title (an action title or a statement's assertion, never the cover's) and its paragraphs the slide's `text`, `support` or `takeaway` slots. `jto_discover` and `jto://blueprints` list the deck blueprint beside the report ones.
