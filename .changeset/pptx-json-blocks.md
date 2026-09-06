---
'@json-to-office/shared': minor
'@json-to-office/shared-pptx': major
'@json-to-office/core-pptx': major
'@json-to-office/quality': minor
'@json-to-office/mcp-server': minor
'@json-to-office/jto': minor
'@json-to-office/jto-ops': minor
---

Replace PPTX slide templates with document-local JSON blocks on the shared contract. The root `templates` array, the slide `template`, `placeholders` and `layout` props, the `MISSING_TEMPLATE`, `UNKNOWN_PLACEHOLDER` and `PLACEHOLDER_NO_POSITION` warnings and the `masters`/`placeholders` renderer capabilities are removed without aliases. A deck defines blocks in `props.blocks` and invokes them with `name: "block"`; a block expands into a transparent `group` of positioned primitives with a source map.

New engine operations: `group` frames (nested coordinates), `direction`/`gap`/`weights` distribution, `gridConfig`, bounded text `fit` (`maxLines`, `shrink`; `text_fit_overflow` at the authored slot), definition `slide` effects (background, notes, grid) and component-slot `props` merged beneath slot content. Slot `role`s feed the new `pptx/required-chrome`, `pptx/action-title` and `pptx/slot-budget` rules; the `consulting-deck` profile requires takeaway and source and bounds the title at two lines.

The `consulting` PPTX theme twins the DOCX house theme. The three shipped playground decks are converted; the new `consulting-deck-blocks` template carries the `action-chart` definition and `jto://blocks` lists both formats. Starters adopt the house theme. Corpus template cases are replaced by block cases with new goldens.
