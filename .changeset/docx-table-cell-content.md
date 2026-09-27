---
'@json-to-office/shared-docx': minor
'@json-to-office/core-docx': minor
'@json-to-office/quality': minor
'@json-to-office/jto-ops': minor
'@json-to-office/mcp-server': minor
'@json-to-office/design-evals': patch
---

A DOCX table cell's `content` now takes a string or one of `paragraph`, `image`, `visual` and `highcharts`, and validation refuses anything else. The schema typed cell content as any component, but a cell renders one paragraph: a `statistic`, `heading`, `list`, nested `table` or any other component came out as the grey text `[Unsupported component type: statistic]`, and nothing told the author. Three statistics set in a table as a KPI row shipped that way.

- Validation reports `unsupported_cell_content` at the cell's `content`, once per cell, naming what a cell takes; `jto_validate` returns it as `E_UNSUPPORTED_CELL_CONTENT` with the fix in `suggestion`. A block whose output puts one in a cell is refused at the slot the author wrote. To set statistics side by side, use a `columns` component with one `statistic` per column.
- The published schema narrows cell content the same way, so an editor offers only those four and `jto_describe_component` names them. `TABLE_CELL_COMPONENTS` exports the list.
- A document that still reaches generation with one — a plugin's output, a caller that turned validation off — renders as before, but generation now warns `W_UNSUPPORTED_CELL_CONTENT` for each such cell, naming where it is.
- The rendered pass gains `rendered/placeholder` (`W_QUALITY_RENDERED_PLACEHOLDER`): the placeholder on a page is reported at the cell that holds the component, or on its page when nothing in the document accounts for it. The text inventory expects the placeholder at such a cell rather than the component's own text, so the statistic's number and label are no longer reported missing. `unrenderedComponentText` and `unrenderedComponentName` in `@json-to-office/quality` spell the placeholder for the renderer and the pass alike.
- The design evals count the new code as an integrity defect and a placeholder leak.
