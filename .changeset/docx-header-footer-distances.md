---
'@json-to-office/core-docx': patch
---

A DOCX page now takes its header and footer distances from the theme's `page.margins.header` and `footer`. They were dropped, so each renderer wrote its own default in their place — 708 twips on the default renderer, 851 and 992 on `office-open` — and the running head and foot of every document sat somewhere other than where the theme put them, and somewhere different on each renderer. A section's own `page.margins.header` / `footer` still takes precedence. A running head taller than the space its distance leaves under the top margin pushes the body down, so on such a document the body can move too.
