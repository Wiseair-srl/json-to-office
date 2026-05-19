# Theme guide

`json-to-office` ships built-in themes. Reference them by name via `props.theme: "<name>"` — don't duplicate JSON in your document. Don't hardcode hex colors in component props; use the theme's token names (`primary`, `text`, `background`, etc.) so a theme swap actually changes the document.

## DOCX themes (built into `@json-to-office/core-docx`)

| Name        | When to use                                                                    |
| ----------- | ------------------------------------------------------------------------------ |
| `minimal`   | Clean B&W reports, contracts, briefs. Arial, generous spacing, justified body. |
| `corporate` | Business reports, board documents. Neutral palette, formal hierarchy.          |
| `modern`    | Marketing reports, case studies. Contemporary sans, more color.                |
| `devportal` | Developer docs, technical specs. Mono-rich, code-friendly.                     |
| `apex`      | Bold editorial — covers, hero pages, brand-led docs.                           |

## PPTX themes (built into `@json-to-office/core-pptx`)

| Name      | When to use                                                            |
| --------- | ---------------------------------------------------------------------- |
| `default` | Generic business deck. Blue/orange accent, white background.           |
| `dark`    | Tech-event keynote, product launch, late-stage pitch. Dark background. |
| `minimal` | Editorial, slow-pitch decks. B&W, Helvetica, light.                    |

## Overriding tokens per-document

If you need a one-off accent without authoring a new theme, override at deck/document level:

```json
{
  "name": "pptx",
  "props": {
    "theme": "minimal",
    "themeOverrides": {
      "colors": { "accent": "#CC785C" }
    }
  }
}
```

(Confirm against [theme.schema.json](../schemas/theme.schema.json) — `themeOverrides` shape mirrors the theme object.)

## When a brand/design-system skill is active

If a brand or design-system skill is loaded in the session, **defer to it**. It will inject the brand theme. Don't pick a built-in theme that conflicts; either use whatever the brand skill provides or omit `theme` entirely and let the brand skill's defaults flow through.

## Anti-patterns

- Hardcoding `#fafafa` in a `text` component prop instead of using `"background2"` token.
- Picking `dark` theme on a body-heavy DOCX export (low contrast on paper).
- Duplicating a theme JSON inside the document to make one color change — use `themeOverrides`.
- Overriding all 12 color tokens — at that point, just author a new theme upstream in the lib.
