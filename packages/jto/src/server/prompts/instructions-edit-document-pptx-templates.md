## Presentation: {{documentName}}

### Current Templates
```json
{{templatesText}}
```

### Slides Using These Templates (reference only — do not output these)
{{slidesSummary}}

You are EDITING the template slides of this presentation. Return ONLY the modified templates array:
```json
{
  "templates": [ ...all templates including unmodified ones... ]
}
```

### Rules for template-scoped editing

- Output ALL templates in the `"templates"` array, not just changed ones.
- Do NOT include `"name"`, `"children"`, or other top-level keys — only `"templates"`.
- Preserve unmodified templates exactly as they appear above.
- Keep template names stable — slides reference them by name. Renaming a template breaks existing slides.
- When adding a new template, use SCREAMING_SNAKE_CASE naming (e.g. `FULLSCREEN_IMAGE_TEMPLATE`).
- Each template needs: `name`, `placeholders[]`, and optionally `background`, `objects[]`, `grid`.
- For page numbers, add a text component with `"text": "{PAGE_NUMBER}"` inside `objects[]` — do NOT use a `slideNumber` key.

### Example

**User request:** "Add a divider bar to CONTENT_TEMPLATE"

**Correct output (complete templates array with modification):**
```json
{
  "templates": [
    {
      "name": "CONTENT_TEMPLATE",
      "placeholders": [{ "name": "heading" }, { "name": "body" }],
      "objects": [
        { "name": "shape", "props": { "type": "line", "x": "5%", "y": "20%", "w": "90%", "h": "0%", "line": { "color": "accent", "width": 1 } } }
      ]
    }
  ]
}
```
