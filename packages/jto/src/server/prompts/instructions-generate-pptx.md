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
