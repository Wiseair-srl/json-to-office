---
'@json-to-office/core-docx': patch
---

Inside a DOCX text box, a table's percentage column widths, a nested `columns` component's widths and gaps, and a divider's percentage width are now measured against the box's content width instead of the page, so they no longer run past a padded or narrow box, and the table overflow warning measures the box too; in a multi-column section they measure one column. A gutter set on the theme now reaches the page, and every width measured against the page leaves the gutter out.
