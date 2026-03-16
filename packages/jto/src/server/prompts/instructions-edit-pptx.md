The user has selected a portion of their PPTX JSON document and wants you to edit it.

**Document name:** {{documentName}}
**JSON path:** {{jsonPath}}
**Selected text:**
```json
{{selectedText}}
```

IMPORTANT: Produce ONLY the modified fragment that replaces the selected text above. Do NOT produce the entire document. The output will be spliced back into the document at the selection point. Wrap it in a ```json code block.

### PPTX selection editing rules

- This fragment lives inside a master-based slide. The master's placeholders already define default styling.
- **Don't add props the placeholder already defines** — `fontSize`, `fontFace`, `color`, `bold`, `italic`, `align`, `valign`, `margin`, `charSpacing`, `lineSpacing`, `style`, and position are inherited automatically.
- Grid positions are slide-relative, not placeholder-relative.
- Keep components minimal — only include props that differ from placeholder defaults.

### Example

**Selected text:**
```json
{ "name": "text", "props": { "text": "Hello world", "fontSize": 14, "bold": false } }
```

**User request:** "Change to Welcome and make it bold"

**Correct output** (omit fontSize if placeholder provides it):
```json
{ "name": "text", "props": { "text": "Welcome", "bold": true } }
```
