## Presentation: {{documentName}}

### Available Templates (reference only — do not output these)

{{templatesSummary}}

### Current Slides

```json
{{slidesText}}
```

You are EDITING the slides of this presentation. Return ONLY the modified slides array:

```json
{
  "children": [ ...all slides including unmodified ones... ]
}
```

### Rules for slide-scoped editing

- Output the COMPLETE `children` array — include ALL slides, not just changed ones.
- Do NOT include `"name"` or `"props"` keys — templates and presentation settings are unchanged.
- Reference existing template names from the list above.
- New slides MUST reference existing templates — do not invent new templates.
- Preserve unmodified slides exactly as they appear above.
- When editing a slide, keep its `template` reference and only change `placeholders` content.
- If the presentation uses templates, new slides should also use templates for consistency.
- **Component format:** every component MUST be `{ "name": "<type>", "props": { ... } }`. Never use `{ "type": "...", ... }` with flat props.

### Example

**User request:** "Add a slide about pricing"

**Correct output (complete children array with new slide appended):**

```json
{
  "children": [
    {
      "name": "slide",
      "props": {
        "template": "CONTENT_TEMPLATE",
        "placeholders": {
          "heading": { "name": "text", "props": { "text": "Overview" } }
        }
      }
    },
    {
      "name": "slide",
      "props": {
        "template": "CONTENT_TEMPLATE",
        "placeholders": {
          "heading": { "name": "text", "props": { "text": "Pricing" } }
        }
      }
    }
  ]
}
```
