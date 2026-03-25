## Presentation: {{documentName}}

### Current Templates
```json
{{templatesText}}
```

### Slides Using These Templates (reference only — do not output these)
{{slidesSummary}}

You are EDITING the template slides of this presentation. Output **only new or modified** templates:
```json
{
  "templates": [ ...only new/changed templates... ]
}
```

Unchanged templates are automatically preserved — do NOT echo them back.

### Rules for template-scoped editing

- Output ONLY templates you are adding or modifying. Omit unchanged templates entirely.
- Do NOT include `"name"`, `"children"`, or other top-level keys — only `"templates"`.
- When modifying a template, output the **complete** template object (all its placeholders, objects, background, etc.) — not just the changed fields.
- Keep template names stable — slides reference them by name. Renaming a template breaks existing slides.
- To DELETE a template, output: `{ "name": "TEMPLATE_NAME", "_delete": true }`
- When adding a new template, use SCREAMING_SNAKE_CASE naming (e.g. `FULLSCREEN_IMAGE_TEMPLATE`).
- Each template needs: `name`, `placeholders[]`, and optionally `background`, `objects[]`, `grid`.
- For page numbers, add a text component with `"text": "{PAGE_NUMBER}"` inside `objects[]` — do NOT use a `slideNumber` key.

### Example

**User request:** "Add a divider bar to CONTENT_TEMPLATE"

**Correct output (only the modified template):**
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
