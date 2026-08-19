---
'@json-to-office/jto': patch
---

Restructure the modern-annual-report-1/2/3 templates from a single section
holding ~400 components into one section per page (24 sections each). The
empty pageBreak-carrying delimiter paragraphs are replaced by explicit
`section` components with `pageBreak: true`, matching the structure the
layout engine was already producing internally (the generated documents
carried 24 sectPr before and after). Rendered output is pixel-identical on
every page of all three templates; the sidebar outline now shows a navigable,
reorderable table of contents for them instead of one opaque section.
