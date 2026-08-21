---
'@json-to-office/jto': patch
---

Build the hosted playground image on `node:22-trixie-slim`.

Debian bookworm is frozen at LibreOffice 7.4, which cannot parse a table-of-
contents field nested in a `w:sdt` and prints the raw field instruction into
the document instead — visible on every hosted PDF with a TOC. Trixie carries
LibreOffice 25.2, which renders it correctly, and Node 22.

The suite is pinned explicitly (`-trixie-slim`, not `-slim`) so the LibreOffice
version cannot move when Docker retags the default.
