---
'@json-to-office/jto': minor
---

Playground sidebar gains an Outline section — a semantic table of contents
for the document in the active editor tab.

PPTX documents outline as numbered slides labeled by their title text, with
per-component rows (text, chart, table, image, shape…) carrying type icons
and content snippets. DOCX documents outline as the heading hierarchy —
non-heading components nest under their preceding heading, and untitled
`section` containers borrow their first heading or paragraph as a label.
Theme files outline as their top-level keys with nested keys and value
previews one level down.

The tree is bidirectionally synced with Monaco: clicking a node reveals and
flashes its JSON range, and moving the cursor highlights (and auto-expands
to) the node it sits inside. Nodes containing schema validation errors show a
red dot, propagated to their ancestors. Sibling nodes can be drag-reordered —
moving a slide, or a whole DOCX heading section with all its content, as a
single undoable text edit that preserves formatting and keeps collapsed
long-string chips intact (the collapse controller gained a
`resyncDecorations()` primitive that re-anchors chips to their sentinels
after text moves).

The outline is built with jsonc-parser's error-tolerant `parseTree`, so it
stays alive while the JSON is temporarily invalid mid-edit.
