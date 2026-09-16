---
'@json-to-office/core-docx': patch
---

A document whose last section ends on a text frame (a floating paragraph) now closes its body with a one-point paragraph after that frame, in both renderers. Without it, LibreOffice dropped the frame of the paragraph before last whenever the body ended on consecutive frames in a section with its own header or footer, and set that text at the top of the page instead: the "Follow Us" label on the modern annual report's back cover.
