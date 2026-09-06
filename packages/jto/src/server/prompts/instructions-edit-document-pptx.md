## Current {{contentLabel}} ({{documentName}})

The user already has this {{contentLabelLower}} open in the editor:

```json
{{documentText}}
```

IMPORTANT: This {{contentLabelLower}} already exists. You are EDITING it, not generating from scratch. Return the COMPLETE modified {{contentLabelLower}} with the requested changes applied — do NOT return just a fragment.

### Rules for editing presentations

- **Preserve every definition in `pptx.props.blocks`** unless explicitly asked to change it.
- When adding slides, **invoke an existing block** — do not define a new one unless the user asks for a new layout, and never add coordinates to an invocation.
- When editing a slide that invokes a block, keep its `ref` and change only the `slots`.
- If the presentation uses blocks, new slides should invoke blocks too, for consistency.
- **Component format:** every component MUST be `{ "name": "<type>", "props": { ... } }`. Never use `{ "type": "...", ... }` with flat props. Never emit `templates`, `template` or `placeholders` keys.

### Example

**Current presentation (abbreviated):**

```json
{
  "name": "pptx",
  "props": {
    "theme": "consulting",
    "slideWidth": 13.333,
    "slideHeight": 7.5,
    "blocks": {
      "statement": {
        "slots": { "text": { "type": "string", "required": true, "maxWords": 30 } },
        "body": [{ "name": "text", "props": { "text": { "$slot": "/text" }, "style": "display", "x": "3.75%", "y": "30%", "w": "92.5%", "h": "30%" } }]
      }
    }
  },
  "children": [
    {
      "name": "slide",
      "props": { "meta": { "title": "Overview" } },
      "children": [
        { "name": "block", "props": { "ref": "statement", "slots": { "text": "Growth improved as delivery became reliable." } } }
      ]
    }
  ]
}
```

**User request:** "Add a slide about pricing"

**Correct output (full document with the new slide appended, invoking the existing block):**

```json
{
  "name": "pptx",
  "props": {
    "theme": "consulting",
    "slideWidth": 13.333,
    "slideHeight": 7.5,
    "blocks": {
      "statement": {
        "slots": { "text": { "type": "string", "required": true, "maxWords": 30 } },
        "body": [{ "name": "text", "props": { "text": { "$slot": "/text" }, "style": "display", "x": "3.75%", "y": "30%", "w": "92.5%", "h": "30%" } }]
      }
    }
  },
  "children": [
    {
      "name": "slide",
      "props": { "meta": { "title": "Overview" } },
      "children": [
        { "name": "block", "props": { "ref": "statement", "slots": { "text": "Growth improved as delivery became reliable." } } }
      ]
    },
    {
      "name": "slide",
      "props": { "meta": { "title": "Pricing" } },
      "children": [
        { "name": "block", "props": { "ref": "statement", "slots": { "text": "Pricing moves to three tiers: Starter at $9, Pro at $29, Enterprise on request." } } }
      ]
    }
  ]
}
```
