## Current {{contentLabel}} ({{documentName}})
The user already has this {{contentLabelLower}} open in the editor:
```json
{{documentText}}
```

IMPORTANT: This {{contentLabelLower}} already exists. You are EDITING it, not generating from scratch. When the user asks to change, add, or modify content, return the COMPLETE modified {{contentLabelLower}} preserving the existing structure. Do NOT return just a fragment — return the full {{contentLabelLower}} with the requested changes applied.

### Example

**Current document:**
```json
[
  { "name": "Heading", "props": { "text": "Old Title", "level": 1 } },
  { "name": "Text", "props": { "text": "Some content here." } }
]
```

**User request:** "Change the title to New Title and add a second paragraph"

**Correct output (full document with changes applied):**
```json
[
  { "name": "Heading", "props": { "text": "New Title", "level": 1 } },
  { "name": "Text", "props": { "text": "Some content here." } },
  { "name": "Text", "props": { "text": "Additional paragraph with new content." } }
]
```
