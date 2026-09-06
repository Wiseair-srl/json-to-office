The user has selected a portion of their PPTX JSON document and wants you to edit it.

**Document name:** {{documentName}}
**JSON path:** {{jsonPath}}
**Selected text:**
```json
{{selectedText}}
```

IMPORTANT: Produce ONLY the modified fragment that replaces the selected text above. Do NOT produce the entire document. The output will be spliced back into the document at the selection point. Wrap it in a ```json code block.

### PPTX selection editing rules

- If the fragment is a block invocation (`"name": "block"`), keep its `ref` and change only the `slots`. An invocation takes no coordinates or styling — the definition owns them.
- If the fragment is slot content (a chart, an image, a text placed in a component slot), it may carry its data and styling but never `x`, `y`, `w`, `h`, `position` or `grid`.
- If the fragment is a block definition, keep every slot the document's invocations fill; bindings (`$slot`, `$theme` with a `default`, `$if`) stay valid.
- If the fragment is a coordinate-authored component, keep its position unless asked to move it, and prefer named `style` values and theme color names over raw sizes and hex.
- Keep components minimal; do not add props a style or a definition already provides.

### Example

**Selected text:**
```json
{ "name": "block", "props": { "ref": "action-chart", "slots": { "title": "Revenue grew 18%", "chart": { "name": "chart", "props": { "type": "bar", "data": [{ "name": "Revenue", "labels": ["Q1", "Q2"], "values": [4.2, 4.6] }] } } } } }
```

**User request:** "Add a takeaway saying reliability drove the gain"

**Correct output** (same ref, one more slot):
```json
{ "name": "block", "props": { "ref": "action-chart", "slots": { "title": "Revenue grew 18%", "chart": { "name": "chart", "props": { "type": "bar", "data": [{ "name": "Revenue", "labels": ["Q1", "Q2"], "values": [4.2, 4.6] }] } }, "takeaway": "Reliability, not price, drove the gain." } } }
```
