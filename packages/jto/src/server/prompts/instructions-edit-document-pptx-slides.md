## Presentation: {{documentName}}

### Available blocks (reference only — do not output these)

{{blocksSummary}}

### Current slides

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
- Do NOT include `"name"` or `"props"` keys — the block definitions and presentation settings are unchanged.
- New slides MUST invoke blocks from the list above — do not define new blocks here and do not add coordinates to an invocation.
- Preserve unmodified slides exactly as they appear above.
- When editing a slide that invokes a block, keep its `ref` and change only the `slots`; fill every required slot and respect `maxWords`/`oneLine`.
- **Component format:** every component MUST be `{ "name": "<type>", "props": { ... } }`. Never use `{ "type": "...", ... }` with flat props.

### Example

**User request:** "Add a slide about pricing"

**Correct output (complete children array with the new slide appended):**

```json
{
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
        { "name": "block", "props": { "ref": "statement", "slots": { "text": "Pricing moves to three tiers." } } }
      ]
    }
  ]
}
```
