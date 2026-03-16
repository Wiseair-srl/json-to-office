## Current {{contentLabel}} ({{documentName}})
The user already has this {{contentLabelLower}} open in the editor:
```json
{{documentText}}
```

IMPORTANT: This {{contentLabelLower}} already exists. You are EDITING it, not generating from scratch. Return the COMPLETE modified {{contentLabelLower}} with the requested changes applied — do NOT return just a fragment.

### Rules for editing documents

- **Preserve the existing Report/Section structure** unless the user asks to reorganize.
- Place new content in the appropriate Section based on topic.
- When adding sections, maintain the existing heading hierarchy (level 1 for title, level 2 for sections).
- Keep Header/Footer intact unless explicitly asked to change them.

### Example

**Current document:**
```json
[
  {
    "name": "Report",
    "props": { "title": "Status Report" },
    "children": [
      { "name": "Section", "props": {}, "children": [
        { "name": "Heading", "props": { "text": "Status Report", "level": 1 } },
        { "name": "Paragraph", "props": { "text": "Project is on track." } }
      ]}
    ]
  }
]
```

**User request:** "Add a risks section"

**Correct output (full document with new section):**
```json
[
  {
    "name": "Report",
    "props": { "title": "Status Report" },
    "children": [
      { "name": "Section", "props": {}, "children": [
        { "name": "Heading", "props": { "text": "Status Report", "level": 1 } },
        { "name": "Paragraph", "props": { "text": "Project is on track." } }
      ]},
      { "name": "Section", "props": {}, "children": [
        { "name": "Heading", "props": { "text": "Risks", "level": 2 } },
        { "name": "List", "props": { "items": ["Timeline delay if vendor is late", "Budget overrun on infrastructure"], "type": "bullet" } }
      ]}
    ]
  }
]
```
