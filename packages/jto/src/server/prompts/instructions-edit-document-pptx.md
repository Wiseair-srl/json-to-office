## Current {{contentLabel}} ({{documentName}})

The user already has this {{contentLabelLower}} open in the editor:

```json
{{documentText}}
```

IMPORTANT: This {{contentLabelLower}} already exists. You are EDITING it, not generating from scratch. Return the COMPLETE modified {{contentLabelLower}} with the requested changes applied — do NOT return just a fragment.

### Rules for editing presentations

- **Preserve all existing templates** in `pptx.props.templates` unless explicitly asked to modify them.
- When adding new slides, **reference existing template names** — do not invent new templates unless the user asks for a new layout.
- When editing a slide, keep its `template` reference and only change the `placeholders` content.
- If the presentation uses templates, new slides should also use templates for consistency.
- **Component format:** every component MUST be `{ "name": "<type>", "props": { ... } }`. Never use `{ "type": "...", ... }` with flat props.

### Example

**Current presentation (abbreviated):**

```json
{
  "name": "pptx",
  "props": {
    "templates": [
      {
        "name": "CONTENT_TEMPLATE",
        "placeholders": [
          { "name": "heading", "type": "title" },
          { "name": "body", "type": "body" }
        ]
      }
    ]
  },
  "children": [
    {
      "name": "slide",
      "props": {
        "template": "CONTENT_TEMPLATE",
        "placeholders": {
          "heading": { "name": "text", "props": { "text": "Overview" } },
          "body": { "name": "text", "props": { "text": "Content here." } }
        }
      }
    }
  ]
}
```

**User request:** "Add a slide about pricing"

**Correct output (full document with new slide appended, using existing template):**

```json
{
  "name": "pptx",
  "props": {
    "templates": [
      {
        "name": "CONTENT_TEMPLATE",
        "placeholders": [
          { "name": "heading", "type": "title" },
          { "name": "body", "type": "body" }
        ]
      }
    ]
  },
  "children": [
    {
      "name": "slide",
      "props": {
        "template": "CONTENT_TEMPLATE",
        "placeholders": {
          "heading": { "name": "text", "props": { "text": "Overview" } },
          "body": { "name": "text", "props": { "text": "Content here." } }
        }
      }
    },
    {
      "name": "slide",
      "props": {
        "template": "CONTENT_TEMPLATE",
        "placeholders": {
          "heading": { "name": "text", "props": { "text": "Pricing" } },
          "body": {
            "name": "table",
            "props": {
              "rows": [
                ["Plan", "Price"],
                ["Starter", "$9/mo"],
                ["Pro", "$29/mo"]
              ],
              "grid": { "column": 0, "row": 2, "columnSpan": 12, "rowSpan": 3 }
            }
          }
        }
      }
    }
  ]
}
```
