---
'@json-to-office/core-docx': patch
---

Emit `w:pgSz/@w:code` for the standard page sizes.

A4, A3, Letter and Legal now carry their DEVMODE paper-size code (9, 8, 1, 5),
so printer drivers can pick the right tray instead of inferring it from the
dimensions. The code is derived from the named size — there is no schema change
and it is never authored.

A custom `{ width, height }` deliberately carries no code. The section-level
`page.size` override now replaces the base size wholesale rather than merging
into it, which is what stops the theme's paper code leaking onto a custom page
and sending the driver after the wrong paper.

This needed docx 9.7.1: 9.5.1 typechecked `code` but dropped it before writing
the section properties.
