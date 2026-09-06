# DOCX document & sections

Reference for the two container components at the top of every Word document tree: the `docx` root and its `section` children. For everything that goes _inside_ a section, see the [component reference](/reference/docx/components).

## Node shape

Every component in a document is an object with this shape:

| Field      | Type                        | Required             | Description                                                                                       |
| ---------- | --------------------------- | -------------------- | ------------------------------------------------------------------------------------------------- |
| `name`     | `string`                    | **yes**              | Component name (`"docx"`, `"section"`, `"paragraph"`, ...)                                        |
| `renderer` | `"docxjs" \| "office-open"` | root only, no        | Backend compatibility profile. Omitted means `docxjs`. Generation options override this field.    |
| `props`    | `object`                    | per component        | Component properties                                                                              |
| `children` | `array`                     | container components | Child components                                                                                  |
| `id`       | `string`                    | no                   | Author-assigned node identifier                                                                   |
| `enabled`  | `boolean`                   | no                   | `false` removes the component (and its subtree) from the render without deleting it from the JSON |

The root `docx` node additionally accepts a `$schema` field, so editors can wire up autocompletion against the published [JSON Schemas](/reference/json-schemas). The schema uses `renderer` to select its backend-specific branch. All schemas reject unknown props (`additionalProperties: false`) unless you opt into `allowUnknownFields` at generation time — see [Validation](/guide/validation).

`renderer` is not only a compatibility profile: some props exist on one backend and not the other, and the schema branch decides which are offered. Threaded comments (`comment.replies`, `comment.resolved`) are `docxjs` only; a natively drawn [`visual`](/reference/docx/components#visual-native-mode) (`renderMode: "native"`) is `office-open` only, and using it under any other backend is a validation error at the component's own `props/renderMode`.

## `docx` (root)

The document root. Its only allowed children are `section` components.

`props` itself is optional: a root written without it generates exactly as one written with `"props": {}`, and the exported JSON Schema marks it optional too, so schema-driven editors agree with the generator. An explicit `props` must still be an object — `null`, `false` or a string is rejected by validation rather than quietly treated as empty.

| Prop                | Type              | Default     | Description                                                                                                                                                                                                                                                                                                             |
| ------------------- | ----------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `theme`             | `string`          | `'minimal'` | Theme name — built-ins are `minimal`, `corporate`, `modern`; custom themes are matched case-insensitively from the `customThemes` generation option. An unknown name silently falls back to `minimal`. See [Themes & styling](/guide/themes).                                                                           |
| `componentDefaults` | `object`          | —           | Per-component default props (e.g. default `spacing` for every `paragraph`). Overrides the theme's own `componentDefaults`; component-level props override both. Supported keys: `heading`, `paragraph`, `image`, `statistic`, `table`, `section`, `columns`, `list`. The `revision` prop cannot be defaulted.           |
| `language`          | `string` (BCP-47) | —           | Word's default proofing language, e.g. `"en-US"`, `"it-IT"`. Pattern: 2–3 letter language code plus optional subtags.                                                                                                                                                                                                   |
| `noProofWords`      | `string[]`        | —           | Allowlist of known words: whole-word, case-insensitive occurrences are emitted as no-proof runs (no spell-check squiggles). Merged on top of the theme's own list.                                                                                                                                                      |
| `trackRevisions`    | `boolean`         | —           | Open the document in track-changes mode. Set automatically on redline documents produced by `diffDocuments` / `jto docx diff`.                                                                                                                                                                                          |
| `metadata`          | `object`          | —           | Document metadata (see below). Written into the `.docx` package's document properties (`docProps/core.xml`, plus `docProps/custom.xml` for `company` and `version`), and also exposed to plugin components via the render context. `metadata.date` additionally drives placeholder resolution and the render cache key. |

### `metadata` fields

All fields are optional strings unless noted. The **Document property** column names the OOXML property the field is written to; Word surfaces those under File → Info → Properties. A dash means the field is not written into the package at all.

| Field         | Type       | Document property                    | Description                                                             |
| ------------- | ---------- | ------------------------------------ | ----------------------------------------------------------------------- |
| `title`       | `string`   | `dc:title`                           | Document title                                                          |
| `subtitle`    | `string`   | `dc:subject`                         | Document subtitle — Word calls this slot "Subject"                      |
| `description` | `string`   | `dc:description`                     | Description / abstract                                                  |
| `author`      | `string`   | `dc:creator` and `cp:lastModifiedBy` | Author name — written to both; it is the only person the document knows |
| `company`     | `string`   | custom property `Company`            | Company name (see the note below)                                       |
| `version`     | `string`   | custom property `Version`            | Document version, e.g. `"1.0"`, `"2024.3"`                              |
| `date`        | `string`   | —                                    | Display date; also resolves `{DATE}` / `{DATETIME}`                     |
| `tags`        | `string[]` | `cp:keywords`                        | Keyword tags, joined with `, `                                          |

OOXML core properties have no slot for a company or a version string, so both are written as **custom** document properties (`Company`, `Version`) in `docProps/custom.xml` — Word surfaces them under Advanced Properties → Custom. The part is always present in the package; set neither field and it is simply an empty `<Properties/>` element.

One field is deliberately not written into document properties: `date` is a display/placeholder value. It fixes the generation date used by `{DATE}` and `{DATETIME}` (and by the render cache key), not a package timestamp.

::: warning No `created` / `modified` here
The metadata object has **no** `created` or `modified` field, and supplying one fails validation (`additionalProperties: false`) unless you enable [`allowUnknownFields`](/guide/validation), which ignores it for validation. Do not rely on that option as a sanitization step.

Package timestamps are not authored per document: `dcterms:created` and `dcterms:modified` come from the **`generatedAt` generation option**, which the deterministic packaging step writes over whatever the `docx` library stamped. Set `generatedAt` to control them; leave it unset and every build gets the same fixed epoch, which is what keeps output byte-identical. With `deterministic: false` that rewrite is skipped entirely and the timestamps are the `docx` library's wall clock — `generatedAt` has no effect on them. See [Reproducible output](/guide/core-concepts#reproducible-output).
:::

Everything that _is_ written comes straight from the input JSON, so metadata never makes output non-deterministic: two renders of the same document — custom properties included — are byte-identical.

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

| Prop        | Type                                | Default                                     | Description                                                                                                                                                                                                                                                                                                                                                             |
| ----------- | ----------------------------------- | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `meta`      | `{ title? }`                        | —                                           | Authoring metadata; never rendered. `meta.title` labels the section in editors and outlines (e.g. the playground sidebar). For a visible title, add a `heading` child.                                                                                                                                                                                                  |
| `header`    | `Component[]` \| `'linkToPrevious'` | —                                           | Header content: an array of components (paragraphs, images, tables, ...), or the literal string `'linkToPrevious'` to reuse the previous section's header.                                                                                                                                                                                                              |
| `footer`    | `Component[]` \| `'linkToPrevious'` | —                                           | Same as `header`, for the footer.                                                                                                                                                                                                                                                                                                                                       |
| `pageBreak` | `boolean`                           | `true` (schema) / `false` (built-in themes) | Start the section on a new page. The schema default is `true`, but every built-in theme overrides it to `false` via `componentDefaults.section`, so sections flow continuously unless you set `pageBreak: true`. Defaults apply whether or not the node declares `props`: a section written with **no `props` key at all** behaves exactly like one with `"props": {}`. |
| `spacing`   | `{ before?, after? }` (points, ≥ 0) | —                                           | Vertical spacing around the section content.                                                                                                                                                                                                                                                                                                                            |
| `page`      | `object`                            | theme's page setup                          | Per-section page geometry override (see below).                                                                                                                                                                                                                                                                                                                         |

::: warning
A section without a `props` key still resolves `componentDefaults`, so it does not break to a new page on its own. Set `"pageBreak": true` explicitly when you want one.

A section takes no `title`/`level` props. Name a section with `meta.title` (not rendered) and add an explicit `heading` child for a visible title.
:::

### `page` override

| Field     | Type                                                               | Description                                                                                                                                                                      |
| --------- | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `size`    | `'A4'` \| `'A3'` \| `'LETTER'` \| `'LEGAL'` \| `{ width, height }` | Page size preset or explicit dimensions. A preset also emits the OOXML paper code (`w:pgSz/@w:code`) that printer drivers use to pick a tray; explicit dimensions carry no code. |
| `margins` | `{ top?, bottom?, left?, right?, header?, footer?, gutter? }`      | Margins in **twips** (1440 twips = 1 inch), each ≥ 0. `header`/`footer` set the distance of header/footer from the page edge.                                                    |

When `page` is omitted, the section inherits the theme's `page` block (the `minimal` theme uses A4 with 1440-twip top/bottom and 1080-twip left/right margins). See [the theme schema](/reference/theme-schema).

### Placeholders in headers and footers

Header and footer text supports the same inline syntax as body text, including the dynamic placeholders `{PAGE}`, `{TOTAL_PAGES}`, `{DATE}`, `{DATETIME}`, and `{YEAR}` — `{PAGE}` and `{TOTAL_PAGES}` render as live Word page-number fields.

### Example

```json
{
  "name": "section",
  "props": {
    "meta": { "title": "Financial Results" },
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
    { "name": "heading", "props": { "text": "Financial Results", "level": 1 } },
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
