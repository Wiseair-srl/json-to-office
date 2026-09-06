# Core concepts

Every json-to-office document — Word or PowerPoint — is a single JSON tree built from one repeating building block: the component node. Once you understand that node shape, how containers constrain their children, and which units each context expects, you can read and write any document the library accepts.

## The component node

Every node in the tree has the same shape:

```json
{
  "name": "paragraph",
  "id": "intro",
  "enabled": true,
  "props": { "text": "Hello **world**" },
  "children": []
}
```

| Field      | Type      | Required | Description                                                                                                                       |
| ---------- | --------- | -------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `name`     | `string`  | **yes**  | Component type — the discriminator that selects the props schema (`"docx"`, `"section"`, `"paragraph"`, `"slide"`, `"chart"`, …). |
| `props`    | `object`  | **yes**  | Component-specific properties, validated against that component's schema. Unknown props are rejected by default.                  |
| `id`       | `string`  | no       | Stable identifier. In DOCX, a paragraph `id` doubles as a bookmark anchor for internal links (`[jump](#intro)`).                  |
| `enabled`  | `boolean` | no       | Defaults to `true`. Set `false` to filter the node out of the render entirely — see below.                                        |
| `children` | `array`   | no       | Child component nodes. Only container components accept children.                                                                 |

The root node of a DOCX document must be named `docx`; the root of a PPTX document must be named `pptx`. The root is also the only node that may carry a `$schema` field, so editors can wire up autocomplete (see [JSON Schemas](/reference/json-schemas)).

```json
{
  "name": "docx",
  "props": { "theme": "minimal" },
  "children": [
    {
      "name": "section",
      "props": {},
      "children": [
        { "name": "heading", "props": { "text": "Q1 Report", "level": 1 } },
        { "name": "paragraph", "props": { "text": "Revenue grew **32%**." } }
      ]
    }
  ]
}
```

::: info Naming
The internal TypeScript types for the DOCX root are named `ReportProps` / `ReportComponentDefinition`, but the JSON component name is always `"docx"`. Similarly, PPTX uses `PresentationProps` internally and `"pptx"` in JSON.
:::

## Containers vs. content components

Components fall into two categories:

- **Containers** hold other components via `children`. Each container declares exactly which child names it accepts, and the schemas narrow the union accordingly — so validation tells you precisely when a child is out of place.
- **Content components** are leaves. They render actual output (text, images, charts, tables) and must not carry `children`. Any nesting they support happens through props — for example, DOCX table cells embed components via `content`, and PPTX slides can inject components through `placeholders`.

Allowed children per container:

| Format | Container  | Allowed children                                                                                                                                           |
| ------ | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DOCX   | `docx`     | `section` only                                                                                                                                             |
| DOCX   | `section`  | `heading`, `paragraph`, `image`, `statistic`, `table`, `list`, `toc`, `divider`, `highcharts`, `chart`¹, `visual`, `columns`, `text-box`, `block`, `group` |
| DOCX   | `columns`  | Same as `section`, minus `columns` (no nested column layouts)                                                                                              |
| DOCX   | `text-box` | `heading`, `paragraph`, `image`, `divider`                                                                                                                 |
| PPTX   | `pptx`     | `slide` only                                                                                                                                               |
| PPTX   | `slide`    | `text`, `image`, `shape`, `table`, `highcharts`, `chart`                                                                                                   |

¹ `chart` needs `renderer: "office-open"`; the default `docxjs` renderer has no chart primitive and omits it from its profile.

Plugin-defined custom components are additionally allowed as children of any container — the processor expands them into standard components before rendering (see [Architecture](/guide/architecture)).

Full per-component prop tables live in the reference: [DOCX components](/reference/docx/components), [PPTX components](/reference/pptx/components).

## Toggling content with `enabled: false`

Any node with `enabled: false` is filtered out before rendering, along with its subtree. This is a first-class feature of the document-as-data model: because the document is plain JSON, you can keep optional sections, draft slides, or per-tenant blocks in one template and switch them on or off programmatically — no string templating, no conditional code.

```json
{
  "name": "slide",
  "enabled": false,
  "props": { "notes": "Hidden until the appendix is approved" },
  "children": []
}
```

::: tip
`enabled: false` removes content from the output. If you want a slide that ships in the file but doesn't show during a presentation, use the PPTX slide prop `hidden: true` instead.
:::

## Units cheat-sheet

Office formats use different native units in different places, and json-to-office follows the conventions of each context rather than flattening everything into one unit. Keep this table handy:

### DOCX

| Context                                           | Unit                                                                           |
| ------------------------------------------------- | ------------------------------------------------------------------------------ |
| Font sizes                                        | points                                                                         |
| `spacing` (`before` / `after`), list item spacing | points                                                                         |
| Column widths and gaps (`columns`)                | points, or `"%"` strings                                                       |
| Table cell padding, cell height, border sizes     | points                                                                         |
| Image `width` / `height`                          | pixels, or `"%"` strings (relative to `widthRelativeTo`: content area or page) |
| Floating position offsets                         | twips (1/20 pt), or `"%"` strings                                              |
| Floating frame `width` / `height`                 | twips                                                                          |
| Theme page margins                                | twips                                                                          |
| `visual` canvas `width` / `height`                | inches                                                                         |

### PPTX

| Context                                          | Unit                                                 |
| ------------------------------------------------ | ---------------------------------------------------- |
| Element positions and sizes (`x`, `y`, `w`, `h`) | inches, or `"%"` strings (relative to slide size)    |
| Slide dimensions (`slideWidth` / `slideHeight`)  | inches (defaults 10 × 7.5; use 13.33 × 7.5 for 16:9) |
| Grid `margin` / `gutter`                         | inches                                               |
| Font sizes, line spacing, character spacing      | points                                               |
| Text/table cell margins, shadow blur and offset  | points                                               |
| `rotate`                                         | degrees                                              |

In PPTX you rarely position by hand: the [grid system](/reference/pptx/slides-and-grid) lets you place elements by `column` / `row` / `columnSpan` / `rowSpan` on a configurable grid (12 columns × 6 rows by default), and the library resolves those to inches for you.

## Inline markdown and placeholders (DOCX)

DOCX text props (`paragraph.text`, `heading.text`, list items) support a small inline-markdown dialect, so rich formatting stays inside plain strings:

- `**bold**` or `__bold__`, `*italic*` or `_italic_`, `***bold italic***`
- `\n` for line breaks
- `[link text](https://example.com)` for hyperlinks; `[jump](#some-id)` links to the paragraph whose `id` is `some-id`
- `{PLACEHOLDER}` tokens resolved at render time: `{PAGE}` (current page number), `{TOTAL_PAGES}`, `{DATE}`, `{DATETIME}`, `{YEAR}`. Unknown placeholders are kept as literal text.

```json
{
  "name": "paragraph",
  "props": { "text": "Page {PAGE} of {TOTAL_PAGES} — see [terms](#terms)" }
}
```

Image and `visual` captions support the bold/italic subset (`**bold**`, `*italic*`, `***both***`).

PPTX `text` components have their own pair of placeholders, `{PAGE_NUMBER}` and `{PAGE_COUNT}`, with an optional zero-padded format via the presentation-level `pageNumberFormat: "09"` prop.

## Semantic color tokens

Wherever a color is accepted, you can pass either a hex value or a **semantic token** — a named slot resolved against the active theme:

- **DOCX** themes define 13 required slots, including `primary`, `secondary`, `accent`, `text`, `background`, `border`, plus finer-grained variants like `textSecondary`, `textMuted`, and `backgroundSecondary` — and three optional chart-only slots, `accent4`, `accent5`, `accent6`.
- **PPTX** themes define a 10-slot scheme: `primary`, `secondary`, `accent`, `background`, `text` (required), plus optional `text2`, `background2`, `accent4`, `accent5`, `accent6`. PowerPoint-style aliases also work (`accent1` → `primary`, `tx1` → `text`, `bg1` → `background`, …).

```json
{ "name": "slide", "props": { "background": { "color": "background" } } }
```

Using tokens instead of hex keeps documents theme-portable: switch the theme name and every token re-resolves. Chart palettes follow the theme too — both formats default their series colors to `["primary", "secondary", "accent", "accent4", "accent5", "accent6"]`, and both skip a slot the theme leaves unset rather than padding it. See [Themes & styling](/guide/themes) for the full theming model and [Charts](/guide/charts#theme-palette) for the palette details.

## The `componentDefaults` cascade

Repeating the same props on every node gets tedious, so defaults cascade from broader scopes to narrower ones. Later layers win:

1. **Theme `componentDefaults`** — per-component-type default props defined in the theme.
2. **Document-level `componentDefaults`** — set on the root `docx` / `pptx` props, merged on top of the theme's.
3. **(PPTX only) placeholder position and `defaults.props`** — when a slide fills a template placeholder, the placeholder's position and default props apply next.
4. **The component's own `props`** — always win.

```json
{
  "name": "pptx",
  "props": {
    "theme": "default",
    "componentDefaults": {
      "text": { "fontSize": 14, "color": "text" },
      "chart": { "showLegend": true, "legendPos": "b" }
    }
  },
  "children": []
}
```

In DOCX, `componentDefaults` accepts partial props for `heading`, `paragraph`, `image`, `statistic`, `table`, `section`, `columns`, and `list`. In PPTX it accepts partial props for `text`, `image`, `shape`, `table`, `highcharts`, and `chart`. PPTX `text` components additionally sit inside a style cascade: own props → named `style` preset → theme defaults.

## Keep the JSON canonical

The JSON definition, not the generated file, is the source of truth worth versioning:

- Diffs are meaningful. Version your `.docx.json` files in git and review changes as text; use the [document diff engine](/guide/writing-docx) to turn two JSON versions into a native Word redline with tracked changes.
- Tracked-change metadata is stable rather than wall-clock: a revision's `date` defaults to the Unix epoch rather than "now", so redlines don't churn between runs.

This separation makes the format a reliable target for LLM generation: the model produces validated data, and predictable code renders it. See [LLM generation](/guide/llms).

## Reproducible output

Generation is deterministic by default. Rendering the same JSON twice produces **byte-identical** archives, so you can hash the output, cache on it, or assert on it in tests.

Office files are full of values that would otherwise change on every run, so json-to-office normalizes them:

- **Package metadata** — `dcterms:created` / `dcterms:modified` in `docProps/core.xml`.
- **ZIP entry timestamps** — written from UTC components, so the bytes match regardless of the building machine's timezone.
- **Generated identifiers** — bookmark, revision, and numbering IDs come from per-document registries rather than counters seeded by the clock.
- **Date placeholders** — `{DATE}` and `{DATETIME}` resolve against the document's generation date, not `Date.now()`.
- **Chart IDs** — PPTX chart parts are renumbered from 1, and the XLSX packages embedded in native charts are normalized recursively (they carry their own timestamps).

Two options control this, on both formats:

```ts
// Default: stable epoch, byte-identical across runs and machines.
await generateBufferFromJson(doc);

// Stamp a real build timestamp — still reproducible for that timestamp.
// Strings are parsed as dates, so pass an ISO-8601 value, not Unix seconds.
await generateBufferFromJson(doc, { generatedAt: '2025-06-07T08:09:10Z' });

// Opt out entirely and use the wall clock.
await generateBufferFromJson(doc, { deterministic: false });
```

`generatedAt` must be a valid date on or after 1980-01-01 — the earliest a ZIP header can represent — and generation throws otherwise rather than silently writing a bogus timestamp.

::: info What reproducibility does not cover
Byte-identity holds when the json-to-office version, the JSON, the theme, and the bytes of every external asset are unchanged. Remote images, fonts fetched at generation time, and chart-rendering services are inputs too: pin them when output stability matters. Upgrading json-to-office can legitimately change output bytes.
:::

## Where to go next

- [Writing DOCX documents](/guide/writing-docx) and [Writing PPTX presentations](/guide/writing-pptx) — format-specific walkthroughs
- [Themes & styling](/guide/themes) — the theme schema and the color/font/style cascade in depth
- [Validation](/guide/validation) — how documents are checked before and during generation
- [Architecture](/guide/architecture) — the processor/renderer pipeline and the plugin system
