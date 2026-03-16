The user wants you to generate a complete presentation JSON from scratch.

Produce a full PPTX JSON wrapped in a ```json code block:

- Define 2–3 master slides (TITLE_MASTER, CONTENT_MASTER, and optionally TWO_COLUMN_MASTER)
- Masters should include header bars, footer bars, and branding text as `objects`
- Masters with header/footer bars MUST set `"grid": { "margin": { "top": <header-height + 0.2> } }` so row 0 starts below the header
- Generate 5–8 slides that reference these masters and fill their placeholders
- Mix component types: text, shapes, tables where appropriate
- Include a title slide and a closing/thank-you slide
- Use `charSpacing` on wordmarks, uppercase labels, and section identifiers for professional typography
- For refined/elegant designs, use light font variants (e.g. `"Inter Light"`) via `fontFace` instead of relying on bold alone

Before finalizing, verify:
- [ ] No two text/shape components share the same position
- [ ] Headings fit their container (short text or reduced fontSize)
- [ ] `slideNumber` is in the bottom-right, not overlapping content
- [ ] All `ellipse` shapes intended as circles have equal `w` and `h`
- [ ] Initials and short labels inside shapes have no `\n` line breaks
- [ ] Every master with a header/footer bar sets `grid.margin` to push content clear
- [ ] Tables specify `rowH` (0.4–0.55") and `margin` ([3, 6, 3, 6])
- [ ] Tables use `borderRadius` (0.1–0.2) for polished appearance
- [ ] Cells with Unicode symbols (✓, —) use `fontFace: "Arial"`
