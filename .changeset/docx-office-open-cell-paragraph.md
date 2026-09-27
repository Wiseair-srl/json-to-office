---
'@json-to-office/core-docx': patch
---

Every table cell the `office-open` DOCX renderer writes now ends on a paragraph, as on the default renderer. A cell whose content ended on a nested table was closed right after `</w:tbl>`, which Word tolerates and LibreOffice misreads: the client report's cover band, a text box floated to the foot of the page with a table inside, rendered in the flow under the subtitle in the LibreOffice preview, without its top rule and with its first label indented past its value. Such a cell now gets the empty paragraph the default renderer writes there, and the band lands at the foot of the cover on both renderers.

A section that ends on a table or a table of contents now closes its bookmark after a one-point paragraph on `office-open`, as on the default renderer. Without it a floating table there was followed directly by the section break, and a cover band whose client name wraps, reaching past the bottom margin, gave the cover a second, empty page in the LibreOffice preview.
