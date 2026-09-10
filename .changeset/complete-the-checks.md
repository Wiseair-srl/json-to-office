---
'@json-to-office/quality': minor
'@json-to-office/core-docx': minor
'@json-to-office/core-pptx': minor
'@json-to-office/jto-ops': minor
'@json-to-office/mcp-server': minor
'@json-to-office/jto': minor
---

Complete the design checks: theme and profile consistency in PPTX, the content hierarchy and integrity inventory in both formats, and the last rendered detector (#332, #347, #344, #334).

**PPTX is judged against its theme's sizes.** `pptx/type-scale`, `pptx/size-count` and `pptx/role-drift` are the twins of the DOCX rules, reading the resolved theme's named styles, its type roles projected onto them, the deck default and the canvas's type scale — so a custom theme is judged by its own values. `pptx/title-drift` has no theme value to read, because no theme states where a title goes: it compares each title with the deck's other titles of the same kind, block by block, so a statement slide that centres its assertion is not drift. All four are off until a profile turns them on; `consulting-deck` does.

**Ten content and integrity rules close the bounded inventory.** DOCX: the measure body copy runs at, a section that renders nothing, a section carrying prose under no heading, a heading a page break can strand (with the `keepNext` patch that binds it), a figure with neither caption nor alt text, and a document with more headings than the profile allows without a contents page. PPTX: bullets past the profile's count or length, content outside the theme's safe area that is neither chrome nor a full bleed, and a content slide nothing names. Both formats gain `image-aspect`, which reads the asset where the document carries it — a data URI, or an inline SVG's viewBox — and says nothing when one side is left for the asset to supply or when PPTX `sizing` fits the image to its box.

**`rendered/table-split`** names a table broken badly across a page: its header alone at a page foot, or one row alone on either side of the break, reported at the row's leftmost cell. The labelled mapping corpus gains the case and scores precision and recall of 1.000 over 51 entries.

**Two reference documents were wrong and are fixed.** The report template's LETTER demo section ran 123 characters a line at half-inch margins; its margins are now three-quarters of an inch. The deck cover stretched any logo that was not 18:10; the frame now states a width and lets the height follow the asset, as the report cover already did.

Every new rule names the value it expected and whether the theme, the profile or the asset asked for it, and appears in the generated design guide.
