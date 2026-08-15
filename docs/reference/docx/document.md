# DOCX document & sections

Reference for the two container components at the top of every Word document tree: the `docx` root and its `section` children. For everything that goes _inside_ a section, see the [component reference](/reference/docx/components).

## Node shape

Every component in a document is an object with this shape:

| Field      | Type      | Required             | Description                                                                                       |
| ---------- | --------- | -------------------- | ------------------------------------------------------------------------------------------------- |
| `name`     | `string`  | **yes**              | Component name (`"docx"`, `"section"`, `"paragraph"`, ...)                                        |
| `props`    | `object`  | per component        | Component properties                                                                              |
| `children` | `array`   | container components | Child components                                                                                  |
| `id`       | `string`  | no                   | Author-assigned node identifier                                                                   |
| `enabled`  | `boolean` | no                   | `false` removes the component (and its subtree) from the render without deleting it from the JSON |

The root `docx` node additionally accepts a `$schema` field, so editors can wire up autocompletion against the published [JSON Schemas](/reference/json-schemas). All schemas reject unknown props (`additionalProperties: false`) unless you opt into `allowUnknownFields` at generation time — see [Validation](/guide/validation).

## `docx` (root)

The document root. Its only allowed children are `section` components.

| Prop                | Type              | Default     | Description                                                                                                                                                                                                                                                                                                   |
| ------------------- | ----------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `theme`             | `string`          | `'minimal'` | Theme name — built-ins are `minimal`, `corporate`, `modern`; custom themes are matched case-insensitively from the `customThemes` generation option. An unknown name silently falls back to `minimal`. See [Themes & styling](/guide/themes).                                                                 |
| `componentDefaults` | `object`          | —           | Per-component default props (e.g. default `spacing` for every `paragraph`). Overrides the theme's own `componentDefaults`; component-level props override both. Supported keys: `heading`, `paragraph`, `image`, `statistic`, `table`, `section`, `columns`, `list`. The `revision` prop cannot be defaulted. |
| `language`          | `string` (BCP-47) | —           | Word's default proofing language, e.g. `"en-US"`, `"it-IT"`. Pattern: 2–3 letter language code plus optional subtags.                                                                                                                                                                                         |
| `noProofWords`      | `string[]`        | —           | Allowlist of known words: whole-word, case-insensitive occurrences are emitted as no-proof runs (no spell-check squiggles). Merged on top of the theme's own list.                                                                                                                                            |
| `trackRevisions`    | `boolean`         | —           | Open the document in track-changes mode. Set automatically on redline documents produced by `diffDocuments` / `jto docx diff`.                                                                                                                                                                                |
| `metadata`          | `object`          | —           | Document metadata (see below). **Informational only** — it is exposed to plugin components via the render context and used in the render cache key, but is _not_ written into Word's built-in document properties.                                                                                            |

### `metadata` fields

All fields are optional strings unless noted.

| Field         | Type                 | Description             |
| ------------- | -------------------- | ----------------------- |
| `title`       | `string`             | Document title          |
| `subtitle`    | `string`             | Document subtitle       |
| `description` | `string`             | Description / abstract  |
| `author`      | `string`             | Author name             |
| `company`     | `string`             | Company name            |
| `date`        | `string`             | Display date            |
| `created`     | `string` (date-time) | Creation timestamp      |
| `modified`    | `string` (date-time) | Last-modified timestamp |
| `version`     | `string`             | Document version        |
| `tags`        | `string[]`           | Keyword tags            |

### Example

```json
{
  "name": "docx",
  "props": {
    "theme": "corporate",
    "language": "en-US",
    "noProofWords": ["Wiseair", "json-to-office"],
    "componentDefaults": {
      "paragraph": { "spacing": { "after": 6 } },
      "table": { "cellDefaults": { "padding": 4 } }
    },
    "metadata": {
      "title": "Master Services Agreement",
      "author": "Legal",
      "company": "Acme Corp",
      "version": "2.1",
      "tags": ["contract", "legal"]
    }
  },
  "children": [{ "name": "section", "children": [] }]
}
```

::: info Naming note
Internally the root props type is called `ReportProps`, but the JSON component name is always `"docx"`.
:::

## `section`

A Word section: a run of pages sharing one header, footer, and page setup. Sections are the only valid children of `docx`, and they hold all content components — see the [component catalog](/reference/docx/components) for what is allowed inside.

| Prop        | Type                                | Default                                     | Description                                                                                                                                                                                                                                                                                                                                                                                                        |
| ----------- | ----------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `title`     | `string`                            | —                                           | Optional section title, rendered as a heading at the top of the section.                                                                                                                                                                                                                                                                                                                                           |
| `level`     | `number` (1–9)                      | `1`                                         | Heading level used for `title`.                                                                                                                                                                                                                                                                                                                                                                                    |
| `header`    | `Component[]` \| `'linkToPrevious'` | —                                           | Header content: an array of components (paragraphs, images, tables, ...), or the literal string `'linkToPrevious'` to reuse the previous section's header.                                                                                                                                                                                                                                                         |
| `footer`    | `Component[]` \| `'linkToPrevious'` | —                                           | Same as `header`, for the footer.                                                                                                                                                                                                                                                                                                                                                                                  |
| `pageBreak` | `boolean`                           | `true` (schema) / `false` (built-in themes) | Start the section on a new page. The schema default is `true`, but every built-in theme overrides it to `false` via `componentDefaults.section`, so a section that has a `props` object flows continuously unless you set `pageBreak: true`. A section written with **no `props` key at all** skips componentDefaults resolution and falls back to `true` — give it at least `"props": {}` if you want it to flow. |
| `spacing`   | `{ before?, after? }` (points, ≥ 0) | —                                           | Vertical spacing around the section content.                                                                                                                                                                                                                                                                                                                                                                       |
| `page`      | `object`                            | theme's page setup                          | Per-section page geometry override (see below).                                                                                                                                                                                                                                                                                                                                                                    |

### `page` override

| Field     | Type                                                               | Description                                                                                                                   |
| --------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `size`    | `'A4'` \| `'A3'` \| `'LETTER'` \| `'LEGAL'` \| `{ width, height }` | Page size preset or explicit dimensions.                                                                                      |
| `margins` | `{ top?, bottom?, left?, right?, header?, footer?, gutter? }`      | Margins in **twips** (1440 twips = 1 inch), each ≥ 0. `header`/`footer` set the distance of header/footer from the page edge. |

When `page` is omitted, the section inherits the theme's `page` block (the `minimal` theme uses A4 with 1440-twip top/bottom and 1080-twip left/right margins). See [the theme schema](/reference/theme-schema).

### Placeholders in headers and footers

Header and footer text supports the same inline syntax as body text, including the dynamic placeholders `{PAGE}`, `{TOTAL_PAGES}`, `{DATE}`, `{DATETIME}`, and `{YEAR}` — `{PAGE}` and `{TOTAL_PAGES}` render as live Word page-number fields.

### Example

```json
{
  "name": "section",
  "props": {
    "title": "Financial Results",
    "level": 1,
    "pageBreak": true,
    "header": [
      {
        "name": "paragraph",
        "props": {
          "text": "Acme Corp — **Confidential**",
          "alignment": "right"
        }
      }
    ],
    "footer": [
      {
        "name": "paragraph",
        "props": {
          "text": "Page {PAGE} of {TOTAL_PAGES}",
          "alignment": "center"
        }
      }
    ],
    "page": {
      "size": "A4",
      "margins": {
        "top": 1440,
        "bottom": 1440,
        "left": 1080,
        "right": 1080,
        "header": 720,
        "footer": 720
      }
    }
  },
  "children": [
    { "name": "paragraph", "props": { "text": "Revenue for the quarter..." } }
  ]
}
```

A follow-up section that keeps the same chrome:

```json
{
  "name": "section",
  "props": {
    "header": "linkToPrevious",
    "footer": "linkToPrevious",
    "pageBreak": true
  },
  "children": [
    { "name": "heading", "props": { "text": "Appendix", "level": 1 } }
  ]
}
```

::: tip
`'linkToPrevious'` is resolved at render time: the section reuses the previous section's header/footer objects, exactly like Word's "Link to Previous" toggle.
:::
