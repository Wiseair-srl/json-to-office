## Presentation: {{documentName}}

### Current block definitions

```json
{{blocksText}}
```

### Slides invoking them (reference only — do not output these)

{{slidesSummary}}

You are EDITING the block definitions of this presentation. Output **only new or modified** definitions:

```json
{
  "blocks": { "<name>": { ...complete definition... } }
}
```

Unchanged definitions are automatically preserved — do NOT echo them back.

### Rules for block-scoped editing

- Output ONLY definitions you are adding or modifying. Omit unchanged definitions entirely.
- Do NOT include `"name"`, `"children"` or other top-level keys — only `"blocks"`.
- When modifying a definition, output the **complete** definition (all its slots, its whole body, its `slide` effects) — not just the changed fields.
- Keep definition names stable — slides reference them by name. Keep every slot the slides above fill, with the same name and type; renaming or removing one breaks those slides.
- To DELETE a definition, output `"<name>": null`.
- New names are lowercase-kebab (`kpi-row`, `two-column`). Each definition needs `slots` and `body`; add `description` and, when the slide should inherit a background or notes, `slide`.
- Author geometry as percentage frames of the slide, bind sizes to type roles with a `default`, wrap optional slots in `$if`, give titles a `fit`, and put page numbers and trackers in the body.
- **Component format:** every item in a `body` MUST be `{ "name": "<type>", "props": { ... } }` or a binding directive. Never `{ "type": "...", ... }` with flat props.

### Example

**User request:** "Add a source line to the statement block"

**Correct output (only the modified definition, complete):**

```json
{
  "blocks": {
    "statement": {
      "description": "One sentence on an otherwise empty slide, with an optional source.",
      "slots": {
        "text": { "type": "string", "required": true, "maxWords": 30, "role": "actionTitle" },
        "source": { "type": "string", "maxWords": 20, "role": "source" }
      },
      "body": [
        {
          "name": "text",
          "props": {
            "text": { "$slot": "/text" },
            "style": "display",
            "fontSize": { "$theme": "/styles/display/fontSize", "default": 28 },
            "x": "3.75%", "y": "30%", "w": "92.5%", "h": "30%",
            "valign": "middle",
            "fit": { "maxLines": 3, "shrink": [24, 22] }
          }
        },
        {
          "$if": "/source",
          "then": {
            "name": "text",
            "props": {
              "text": { "$slot": "/source" },
              "style": "source",
              "fontSize": { "$theme": "/styles/source/fontSize", "default": 9 },
              "x": "3.75%", "y": "94.5%", "w": "75%", "h": "5%"
            }
          }
        }
      ]
    }
  }
}
```
