The user wants you to generate a complete presentation JSON from scratch.

Produce a full PPTX JSON wrapped in a ```json code block. Follow the PPTX guidelines above:

- Define 2–3 master slides (TITLE_MASTER, CONTENT_MASTER, and optionally TWO_COLUMN_MASTER)
- Masters should include header bars, footer bars, and branding text as `objects`
- Generate 5–8 slides that reference these masters and fill their placeholders
- Use grid positioning throughout
- Masters with header/footer bars MUST set `"grid": { "margin": { "top": <header-height + 0.2> } }` so row 0 starts below the header — never leave the grid margin at default when the master has decorative objects
- Use semantic colors (primary, accent, text, etc.) — not hex
- Mix component types: text, shapes, tables where appropriate
- Include a title slide and a closing/thank-you slide
- Use `charSpacing` on wordmarks, uppercase labels, and section identifiers for professional typography
- For refined/elegant designs, use light font variants (e.g. `"Inter Light"`) via `fontFace` instead of relying on bold alone

Before finalizing, verify the output against this checklist:
- [ ] No two text/shape components share the same position — each has its own row or y offset
- [ ] Headings fit their container (short text or reduced fontSize for long titles)
- [ ] `slideNumber` is in the bottom-right, not overlapping any content
- [ ] All `ellipse` shapes intended as circles have equal `w` and `h`
- [ ] Initials and short labels inside shapes have no `\n` line breaks
- [ ] Every master with a header/footer bar sets `grid.margin` to push content clear of fixed objects
- [ ] Tables specify `rowH` (0.4–0.55") and `margin` ([3, 6, 3, 6]) for compact, consistent rows
- [ ] Tables use `borderRadius` (0.1–0.2) for polished rounded-corner appearance
- [ ] Cells with Unicode symbols (✓, —) use `fontFace: "Arial"` for reliable glyph rendering
