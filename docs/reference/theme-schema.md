# Theme schema

Precise reference for both theme file formats: the DOCX `ThemeConfig` (validated against the generated `theme.schema.json`) and the PPTX `ThemeConfig` (usually supplied inline on `props.theme`). For the conceptual guide — tokens, built-ins, cascades — see [Themes & styling](/guide/themes).

## DOCX theme

A DOCX theme is a JSON object (conventionally a `*.docx.theme.json` file). Unknown top-level properties are rejected (`additionalProperties: false`).

| Field               | Type     | Required | Description                                                                                                                                                |
| ------------------- | -------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `$schema`           | string   | no       | Schema URI for editor tooling. The validator injects `./json-schemas/theme.schema.json` when missing.                                                      |
| `name`              | string   | **yes**  | Theme identifier — the value documents reference in `props.theme`.                                                                                         |
| `displayName`       | string   | **yes**  | Human-readable name.                                                                                                                                       |
| `description`       | string   | **yes**  | Short description of the theme.                                                                                                                            |
| `version`           | string   | **yes**  | Theme version string (built-ins use `"2.0.0"`).                                                                                                            |
| `colors`            | object   | **yes**  | The 13-key color scheme (below).                                                                                                                           |
| `fonts`             | object   | **yes**  | Exactly four font slots (below).                                                                                                                           |
| `page`              | object   | **yes**  | Page size and margins (below).                                                                                                                             |
| `styles`            | object   | no       | Named paragraph-style presets, compiled into real Word styles (below).                                                                                     |
| `componentDefaults` | object   | no       | Per-component prop defaults (below).                                                                                                                       |
| `noProofWords`      | string[] | no       | House-style allowlist: whole-word, case-insensitive terms never flagged by Word's spellchecker. The document's own `noProofWords` merges on top at render. |

### `colors`

**13 required keys**:

`primary`, `secondary`, `accent`, `text`, `background`, `border`, `textPrimary`, `textSecondary`, `textMuted`, `borderPrimary`, `borderSecondary`, `backgroundPrimary`, `backgroundSecondary`

**3 optional keys** — `accent4`, `accent5`, `accent6` — named to match the PPTX palette so both formats share one chart-series vocabulary. They exist for the chart palette, though a theme that defines one makes it referenceable from any component color prop like any other token. None of the built-in DOCX themes define them; see [Charts](/guide/charts#theme-palette) for what a theme that omits them produces.

No other key is accepted (`additionalProperties: false`).

Each value matches the pattern `^(#[0-9A-Fa-f]{6}|[a-zA-Z][a-zA-Z0-9]*)$` — either a `#RRGGBB` hex value **or the name of another theme color**. Name references are resolved recursively at render time (so `"border": "backgroundSecondary"` is valid); unknown names throw during generation. Because the second alternative is a _name_, a bare hex is not a hex value here: a digit-leading one (`00FF00`) fails validation, and a letter-leading one (`AABBCC`) passes validation and is then treated as a token name, which throws everywhere `resolveColor` runs. The lone exception is the chart palette, which checks for a bare 6-digit hex before consulting the theme — so `"accent4": "AABBCC"` colors charts while breaking every other use of that token. Always write the `#`.

### `fonts`

Exactly four required slots — `heading`, `body`, `mono`, `light` — each a **font definition**:

| Field              | Type              | Required | Description                                                                                  |
| ------------------ | ----------------- | -------- | -------------------------------------------------------------------------------------------- |
| `family`           | string            | **yes**  | Font family name (see [Fonts](/guide/fonts) for safe families and registration).             |
| `size`             | number (8–72)     | no       | Size in points.                                                                              |
| `color`            | string            | no       | Hex or theme color token.                                                                    |
| `bold`             | boolean           | no       | Equivalent to `fontWeight: 700`.                                                             |
| `fontWeight`       | integer (100–900) | no       | Numeric weight; wins over `bold` when both are set.                                          |
| `italic`           | boolean           | no       | —                                                                                            |
| `underline`        | boolean           | no       | —                                                                                            |
| `lineSpacing`      | object            | no       | `{ "type": "single" \| "atLeast" \| "exactly" \| "double" \| "multiple", "value"?: number }` |
| `spacing`          | object            | no       | `{ "before"?: number, "after"?: number }` (points, ≥ 0).                                     |
| `characterSpacing` | object            | no       | `{ "type": "condensed" \| "expanded", "value": number }`                                     |

### `page`

| Field     | Type             | Required | Description                                                                                                     |
| --------- | ---------------- | -------- | --------------------------------------------------------------------------------------------------------------- |
| `size`    | string or object | **yes**  | One of `"A4"`, `"A3"`, `"LETTER"`, `"LEGAL"`, or a custom `{ "width": number, "height": number }` in twips.     |
| `margins` | object           | **yes**  | All seven keys required, numbers ≥ 0, in twips: `top`, `bottom`, `left`, `right`, `header`, `footer`, `gutter`. |

::: info Twips
Word measures in twips: 1 twip = 1/20 pt, so **1440 twips = 1 inch** and 720 = 0.5 inch.
:::

### `styles`

Known keys: `normal`, `heading1`–`heading6`, `title`, `subtitle` (regular style properties) and `TOC1`–`TOC6` (TOC style properties). Arbitrary **custom style names** are also allowed and can be referenced from paragraphs via `themeStyle`.

Regular style properties = all the text-formatting fields from the font definition table above, plus:

| Field               | Type                                               | Description                                                                                                                                                                                                                  |
| ------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `font`              | `"heading"` \| `"body"` \| `"mono"` \| `"light"`   | Reference into `theme.fonts`.                                                                                                                                                                                                |
| `alignment`         | `"left"` \| `"center"` \| `"right"` \| `"justify"` | Paragraph alignment.                                                                                                                                                                                                         |
| `priority`          | number                                             | Ordering in Word's style gallery.                                                                                                                                                                                            |
| `baseStyle`         | string                                             | Name of a style to inherit from (chains are resolved).                                                                                                                                                                       |
| `followingStyle`    | string                                             | Style applied to the next paragraph when the user presses Enter in Word.                                                                                                                                                     |
| `widowControl`      | boolean                                            | Prevent widow/orphan lines.                                                                                                                                                                                                  |
| `keepNext`          | boolean                                            | Keep with the following paragraph.                                                                                                                                                                                           |
| `keepLinesTogether` | boolean                                            | Keep all lines on one page.                                                                                                                                                                                                  |
| `outlineLevel`      | number                                             | Outline level for navigation/TOC collection.                                                                                                                                                                                 |
| `borders`           | object                                             | Per-side (`top`/`bottom`/`left`/`right`) `{ "style", "size", "color", "space"? }`. `size` is in eighths of a point; `style` is one of the 27 Word border styles (e.g. `single`, `double`, `dashed`, `dotted`, `thick`, ...). |
| `indent`            | object                                             | Paragraph indentation.                                                                                                                                                                                                       |

**TOC styles** (`TOC1`–`TOC6`) deliberately exclude `baseStyle` and add one field:

| Field      | Type  | Description                                                                                                                                                                                                                                                                                                                  |
| ---------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tabStops` | array | Each entry: `{ "type", "position", "leader" }`. `position` is in twips or the string `"max"` (= 9026, the right page edge); `leader` is `"dot"` \| `"hyphen"` \| `"middleDot"` \| `"none"` \| `"underscore"`. Default: `[{ "type": "right", "position": "max", "leader": "none" }]` — the classic right-aligned page number. |

### `componentDefaults`

Optional per-component prop defaults. Allowed keys: `heading`, `paragraph`, `image`, `statistic`, `table`, `section`, `columns`, `list`. Values are partial props objects for the matching component — see [DOCX components](/reference/docx/components). Document-level `props.componentDefaults` deep-merges on top; props on the component itself win over both.

### Complete minimal example

A valid theme with all required fields plus a small `styles` and `componentDefaults` block (colors and margins from the built-in `minimal` theme):

```json
{
  "$schema": "./json-schemas/theme.schema.json",
  "name": "brand",
  "displayName": "Brand Theme",
  "description": "House style for generated reports",
  "version": "2.0.0",
  "colors": {
    "primary": "#000000",
    "secondary": "#666666",
    "accent": "#2c3e50",
    "background": "#ffffff",
    "text": "#2c2c2c",
    "border": "#f0f0f0",
    "textPrimary": "#000000",
    "textSecondary": "#4a4a4a",
    "textMuted": "#999999",
    "borderPrimary": "#e0e0e0",
    "borderSecondary": "#f5f5f5",
    "backgroundPrimary": "#ffffff",
    "backgroundSecondary": "#fafafa"
  },
  "fonts": {
    "heading": { "family": "Arial", "size": 24 },
    "body": { "family": "Arial", "size": 11 },
    "mono": { "family": "Menlo", "size": 10 },
    "light": { "family": "Arial", "size": 24 }
  },
  "page": {
    "size": "A4",
    "margins": {
      "top": 1440,
      "bottom": 1440,
      "left": 1080,
      "right": 1080,
      "header": 720,
      "footer": 720,
      "gutter": 0
    }
  },
  "styles": {
    "normal": {
      "font": "body",
      "lineSpacing": { "type": "multiple", "value": 1.5 },
      "alignment": "justify",
      "spacing": { "after": 9 }
    },
    "heading1": {
      "font": "light",
      "size": 24,
      "color": "primary",
      "spacing": { "before": 18, "after": 12 },
      "keepNext": true
    }
  },
  "componentDefaults": {
    "table": { "hideBorders": true, "cellDefaults": { "padding": 4 } },
    "list": { "format": "bullet" }
  }
}
```

::: tip Runtime defaults
When a theme is loaded programmatically, missing optional pieces are filled from built-in defaults (`normal` at 11 pt, `heading1` 24 pt bold down to `heading6` 11 pt bold, LETTER page with 720-twip margins, and a default color/font set). A theme _file_ must still pass the schema — the defaults matter mostly for partial `ThemeConfig` objects created in code.
:::

## PPTX theme

A PPTX theme is a plain object, most often supplied **inline** on the presentation's `props.theme` (see [Themes & styling](/guide/themes#custom-themes)). Unknown top-level properties are rejected (`additionalProperties: false`). `jto pptx schemas` emits a PPTX `theme.schema.json` generated from this ThemeConfig schema — the format parent determines which theme schema is generated (see [JSON schemas](/reference/json-schemas)).

| Field               | Type   | Required | Description                                                                                    |
| ------------------- | ------ | -------- | ---------------------------------------------------------------------------------------------- |
| `name`              | string | **yes**  | Theme name.                                                                                    |
| `colors`            | object | **yes**  | The 10-slot scheme (below).                                                                    |
| `fonts`             | object | **yes**  | `{ "heading": string, "body": string }` — plain family-name strings, no size/weight here.      |
| `defaults`          | object | **yes**  | `{ "fontSize": number, "fontColor": string }` — base font size in points and base color (hex). |
| `styles`            | object | no       | Partial map of the seven style names (below).                                                  |
| `componentDefaults` | object | no       | Per-component prop defaults (below).                                                           |

### `colors`

| Slot                                                    | Required |
| ------------------------------------------------------- | -------- |
| `primary`, `secondary`, `accent`, `background`, `text`  | **yes**  |
| `text2`, `background2`, `accent4`, `accent5`, `accent6` | no       |

Values are **strict hex** matching `^#?[0-9A-Fa-f]{6}$` (leading `#` optional). Unlike DOCX, palette values cannot reference other color names — token indirection happens only where components _consume_ colors. An unset optional slot resolves to `primary` at render time, with a `THEME_COLOR_FALLBACK` warning, whenever something names the token explicitly; the implicit chart palette skips it instead (below).

`accent4`–`accent6` carry the same names in the [DOCX scheme](#colors) so the chart palette reads one token list in both formats, and both formats skip an unfilled slot identically — the palette shrinks, no warning. Only the PPTX built-ins ship values for them. See [Charts](/guide/charts#theme-palette).

### `styles`

A partial map — override any subset of: `title`, `subtitle`, `heading1`, `heading2`, `heading3`, `body`, `caption`. Each value is a text style:

| Field            | Type                                               | Description                                                                                     |
| ---------------- | -------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `fontSize`       | number                                             | Points.                                                                                         |
| `fontFace`       | string                                             | Font family name.                                                                               |
| `fontColor`      | string                                             | Hex, a semantic token (`primary`, `text2`, ...), or a PowerPoint alias (`accent1`, `tx1`, ...). |
| `bold`           | boolean                                            | —                                                                                               |
| `fontWeight`     | integer (100–900)                                  | Wins over `bold` when both are set.                                                             |
| `italic`         | boolean                                            | —                                                                                               |
| `align`          | `"left"` \| `"center"` \| `"right"` \| `"justify"` | —                                                                                               |
| `lineSpacing`    | number                                             | —                                                                                               |
| `charSpacing`    | number                                             | Points; positive = wider.                                                                       |
| `paraSpaceAfter` | number                                             | Space after paragraph, points.                                                                  |

### `componentDefaults`

Allowed keys: `text`, `image`, `shape`, `table`, `highcharts`, `chart` (extra keys are tolerated, as in the DOCX equivalent). See [PPTX components](/reference/pptx/components) and [PPTX charts](/reference/pptx/charts) for the props each accepts.

### Example

```json
{
  "name": "brand",
  "colors": {
    "primary": "#0C2340",
    "secondary": "#1B3A5C",
    "accent": "#D4A843",
    "background": "#FFFFFF",
    "text": "#1A1A1A",
    "text2": "#5A6B7C",
    "background2": "#F3F5F7",
    "accent4": "#8A9BAA",
    "accent5": "#C4A35A",
    "accent6": "#2E4A66"
  },
  "fonts": { "heading": "Georgia", "body": "Calibri" },
  "defaults": { "fontSize": 18, "fontColor": "#1A1A1A" },
  "styles": {
    "title": {
      "fontSize": 40,
      "bold": true,
      "fontColor": "primary",
      "align": "left"
    },
    "caption": { "fontSize": 10, "italic": true, "fontColor": "text2" }
  },
  "componentDefaults": {
    "table": { "fontSize": 12 }
  }
}
```

::: info Slide grid
The grid used to position slide content (default **12 columns × 6 rows**) is configured separately from the theme — see [Slides & grid](/reference/pptx/slides-and-grid).
:::

## Loading rules

**DOCX** theme files loaded from disk (CLI `--theme-path`, or `loadThemeFromFile` in the library) pass through a hardened loader:

- **`.json` extension only** — anything else is rejected. (`--theme-path` alternatively accepts a JS/TS _module_ that exports the theme as `default` or `theme`; that path bypasses the JSON loader.)
- **10 MB maximum** file size.
- **Path guards** — rejects `..` traversal segments, null bytes, and paths longer than 1000 characters.
- **Empty files are rejected.**
- Content is validated against the theme schema (TypeBox), then runtime defaults are applied.

**PPTX** theme files given to the CLI are read as plain JSON — without the hardened loader or schema validation.

Loaded custom themes are registered under their sanitized `theme.name`, which is what the document's `props.theme` must reference. (The `--theme` flag currently takes effect only in plugin-loaded runs — see the [CLI reference](/reference/cli#generate).)

Validate a theme file without generating anything:

```bash
jto docx validate ./brand.docx.theme.json
```

The validator auto-detects theme files (an object with `colors`/`fonts`/`styles` and no `name: "docx"` root is treated as a theme). See [Validation](/guide/validation).
