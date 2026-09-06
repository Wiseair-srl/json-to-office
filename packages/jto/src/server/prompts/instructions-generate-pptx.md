The user wants you to generate a complete presentation JSON from scratch.

Produce a full PPTX JSON wrapped in a ```json code block:

- Set `theme` (prefer `consulting`), `slideWidth: 13.333` and `slideHeight: 7.5` on `pptx.props`
- Define the blocks the deck needs in `pptx.props.blocks`: copy the reference blocks you invoke verbatim, and define your own (a cover, a statement, a two-column comparison, a metric row) as percentage frames with type-role bindings and `$if` around optional slots
- Generate 5–8 slides; every standard slide invokes a block with `{ "name": "block", "props": { "ref": "...", "slots": { ... } } }` and supplies content only — no coordinates on an invocation or in slot content
- Include a cover slide and a closing slide
- Coordinate-authored slides are for one-off layouts only
- **Every component** (in a block `body`, a component slot, or `slide.children`) MUST use `{ "name": "<type>", "props": { ... } }`. Never `{ "type": "...", ... }` with flat props
- Use `charSpacing` on wordmarks and uppercase labels; use theme color names, not hex

Before finalizing, verify:

- [ ] Every `ref` names a definition present in `props.blocks`
- [ ] Every `required` slot of every invocation is filled; slot text respects `maxWords` and `oneLine`
- [ ] No `templates`, `template`, `placeholders` or `layout` keys anywhere
- [ ] Block bodies use percentage frames and `fit` on titles; theme bindings carry a `default`
- [ ] Page numbers and trackers live in block bodies, not overlapping content
- [ ] Tables specify `rowH` (0.4–0.55") and `margin` ([3, 6, 3, 6])
- [ ] `ellipse` shapes intended as circles have equal `w` and `h`
- [ ] Cells with Unicode symbols (✓, —) use `fontFace: "Arial"`
