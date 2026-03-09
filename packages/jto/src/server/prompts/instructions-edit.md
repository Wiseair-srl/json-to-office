The user has selected a portion of their JSON document and wants you to edit it.

**Document name:** {{documentName}}
**JSON path:** {{jsonPath}}
**Selected text:**
```json
{{selectedText}}
```

IMPORTANT: Produce ONLY the modified fragment that replaces the selected text above. Do NOT produce the entire document. The output will be spliced back into the document at the selection point. Wrap it in a ```json code block.

### Example

**Selected text:**
```json
{ "name": "Text", "props": { "text": "Hello world", "bold": false } }
```

**User request:** "Make it bold and change to Welcome"

**Correct output:**
```json
{ "name": "Text", "props": { "text": "Welcome", "bold": true } }
```
