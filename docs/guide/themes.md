# Themes & styling

json-to-office keeps content and appearance separate: your document JSON says _what_ to render, a theme says _how it should look_. Because colors and fonts are referenced through semantic tokens rather than hard-coded values, swapping one theme name restyles an entire document — no find-and-replace across your JSON.

## Semantic color tokens

Anywhere a component accepts a color, you can pass either a literal hex value (`"#0066CC"`) or a **semantic token** (`"primary"`, `"accent"`, ...). Tokens are resolved against the active theme at generate time. Authoring with tokens is what makes documents portable across themes, so prefer them over raw hex whenever the color has a _role_ (brand color, muted text, subtle border) rather than a one-off value.

The two formats use different token schemes.

### DOCX: 13-color scheme

Word themes define thirteen color keys, all required in a theme file:

| Group      | Tokens                                                   |
| ---------- | -------------------------------------------------------- |
| Core       | `primary`, `secondary`, `accent`                         |
| Text       | `text`, `textPrimary`, `textSecondary`, `textMuted`      |
| Background | `background`, `backgroundPrimary`, `backgroundSecondary` |
| Border     | `border`, `borderPrimary`, `borderSecondary`             |

Resolution rules:

- A `#RRGGBB` value is validated and used as-is; an invalid hex string **throws** at generate time.
- Any other string is looked up in the theme's color map (merged over built-in defaults) and resolved **recursively** — a theme color's value may itself be another token name (e.g. `"border": "backgroundSecondary"`), and the chain is followed until a hex value is reached.
- An unknown token name **throws**. DOCX color resolution is strict by design: a typo fails the build instead of silently producing a wrong color.

### PPTX: 10-slot scheme

PowerPoint themes use a 10-slot palette. Five slots are required, five optional:

| Slot                            | Required | Typical role                          |
| ------------------------------- | -------- | ------------------------------------- |
| `primary`                       | yes      | Main brand color, first chart series  |
| `secondary`                     | yes      | Second brand color                    |
| `accent`                        | yes      | Highlight color                       |
| `background`                    | yes      | Slide background                      |
| `text`                          | yes      | Main text color                       |
| `text2`                         | no       | Secondary text (subtitles, captions)  |
| `background2`                   | no       | Alternate background (cards, stripes) |
| `accent4`, `accent5`, `accent6` | no       | Extra chart-series colors             |

PowerPoint-style **aliases** are accepted anywhere a token is: `accent1` → `primary`, `accent2` → `secondary`, `accent3` → `accent`, `tx1` → `text`, `tx2` → `text2`, `bg1` → `background`, `bg2` → `background2`. This lets JSON produced from existing PowerPoint conventions resolve naturally.

Resolution is more forgiving than DOCX:

- If a token points at an optional slot the theme did not fill, the resolver **falls back to `primary`** and emits a `THEME_COLOR_FALLBACK` warning.
- Literal hex values may omit the `#`, and 3-digit shorthand is expanded (`FFF` → `FFFFFF`). A string that is neither a token nor valid hex produces an `UNKNOWN_COLOR` warning.

::: info Charts inherit the palette
The `chart` and `highcharts` components default their series colors to `['primary', 'secondary', 'accent', 'accent4', 'accent5', 'accent6']`, so a well-filled 10-slot theme gives you an on-brand chart palette for free. See [Charts](/guide/charts).
:::

## Built-in themes

### DOCX themes

Three themes are always registered; **`minimal`** is the default and the fallback for unknown names.

| Theme       | Display name           | primary   | secondary | accent    | Heading font | Body font    | Mono font   |
| ----------- | ---------------------- | --------- | --------- | --------- | ------------ | ------------ | ----------- |
| `minimal`   | Minimal Clean          | `#000000` | `#666666` | `#2c3e50` | Arial 24     | Arial 11     | Menlo 10    |
| `corporate` | Corporate Professional | `#1a365d` | `#2D3748` | `#3182CE` | Georgia 26   | Calibri 11   | Consolas 10 |
| `modern`    | Modern Clean           | `#6D28D9` | `#1E293B` | `#0891B2` | Helvetica 28 | Helvetica 11 | Menlo 10    |

Built packages ship two additional theme files that the runtime loader picks up from `dist`, so they are loadable by name as well:

| Theme       | Display name     | primary   | secondary | accent    | Fonts (heading / body / mono)  |
| ----------- | ---------------- | --------- | --------- | --------- | ------------------------------ |
| `apex`      | Apex Consulting  | `#0C2340` | `#1B3A5C` | `#D4A843` | Georgia / Calibri / Consolas   |
| `devportal` | Developer Portal | `#0F172A` | `#334155` | `#0D9488` | Helvetica / Calibri / Consolas |

### PPTX themes

Three built-in themes: **`default`**, **`dark`**, **`minimal`**. An unknown theme name silently falls back to `default`.

| Slot                   | `default`       | `dark`          | `minimal`             |
| ---------------------- | --------------- | --------------- | --------------------- |
| `primary`              | `#4472C4`       | `#5B9BD5`       | `#000000`             |
| `secondary`            | `#ED7D31`       | `#FF6F61`       | `#666666`             |
| `accent`               | `#70AD47`       | `#6BCB77`       | `#999999`             |
| `background`           | `#FFFFFF`       | `#2D2D2D`       | `#FFFFFF`             |
| `text`                 | `#333333`       | `#FFFFFF`       | `#000000`             |
| `text2`                | `#44546A`       | `#CCCCCC`       | `#444444`             |
| `background2`          | `#E7E6E6`       | `#3D3D3D`       | `#F5F5F5`             |
| `accent4`              | `#FFC000`       | `#FFB347`       | `#BBBBBB`             |
| `accent5`              | `#5B9BD5`       | `#77DD77`       | `#DDDDDD`             |
| `accent6`              | `#70AD47`       | `#AEC6CF`       | `#888888`             |
| Fonts (heading / body) | Arial / Arial   | Arial / Arial   | Helvetica / Helvetica |
| Defaults               | 18pt, `#333333` | 18pt, `#FFFFFF` | 18pt, `#000000`       |

All three share the same set of **style presets**:

| Preset     | Size | Weight/emphasis | Color token | Alignment |
| ---------- | ---- | --------------- | ----------- | --------- |
| `title`    | 36   | bold            | `text`      | center    |
| `subtitle` | 20   | italic          | `text2`     | center    |
| `heading1` | 28   | bold            | `primary`   | —         |
| `heading2` | 22   | bold            | `primary`   | —         |
| `heading3` | 18   | bold            | `text`      | —         |
| `body`     | 14   | —               | —           | —         |
| `caption`  | 10   | italic          | `text2`     | —         |

## Applying a theme

Set `props.theme` on the root component. For DOCX (default `"minimal"`):

```json
{
  "name": "docx",
  "props": { "theme": "corporate" },
  "children": [
    {
      "name": "section",
      "props": {},
      "children": [
        {
          "name": "heading",
          "props": { "text": "Quarterly Report", "level": 1 }
        }
      ]
    }
  ]
}
```

For PPTX (default `"default"`):

```json
{
  "name": "pptx",
  "props": { "theme": "dark" },
  "children": [
    {
      "name": "slide",
      "props": {},
      "children": [
        { "name": "text", "props": { "text": "Q3 Review", "style": "title" } }
      ]
    }
  ]
}
```

## Custom themes

### PPTX: inline theme object

For presentations, `props.theme` accepts either a theme name **or a full inline theme object**, keeping the document fully self-contained — one JSON file carries content and branding:

```json
{
  "name": "pptx",
  "props": {
    "theme": {
      "name": "brand",
      "colors": {
        "primary": "#0C2340",
        "secondary": "#1B3A5C",
        "accent": "#D4A843",
        "background": "#FFFFFF",
        "text": "#1A1A1A",
        "text2": "#5A6B7C",
        "accent4": "#8A9BAA",
        "accent5": "#C4A35A",
        "accent6": "#2E4A66"
      },
      "fonts": { "heading": "Georgia", "body": "Calibri" },
      "defaults": { "fontSize": 18, "fontColor": "#1A1A1A" }
    }
  },
  "children": []
}
```

At generate time the inline object is normalized into a named custom-theme entry (using `theme.name`, or `inline-theme` if unnamed) before the pipeline runs.

### DOCX: `customThemes` option or CLI flags

The DOCX document schema deliberately keeps `props.theme` **string-only**. Custom Word themes are supplied out-of-band:

**Library** — pass a name-to-config map via `options.customThemes` (exact name match first, then case-insensitive, then built-in fallback):

```ts
import { generateAndSaveFromJson } from '@json-to-office/core-docx';
import brandTheme from './brand.docx.theme.json';

await generateAndSaveFromJson(documentJson, 'report.docx', {
  customThemes: { brand: brandTheme },
});
```

**CLI** — point at a theme file with `--theme-path`:

```bash
# --theme-path loads and registers the theme file; also accepts a JS/TS module
# exporting `default` or `theme`
jto docx generate report.json --theme-path ./brand.docx.theme.json
```

The loaded theme is registered under its `name`, which the document's `props.theme` must reference. (The `--theme` flag currently takes effect only in plugin-loaded runs — see the [CLI reference](/reference/cli#generate).)

Theme files are loaded with hardening guards (`.json` only, 10 MB cap, path-traversal checks) — see [Theme schema reference](/reference/theme-schema#loading-rules) for details, and the full file formats for both DOCX and PPTX themes.

## `componentDefaults` cascade

Both theme files and documents can set default props per component type, so you can say "all tables are striped" once instead of on every table. The cascade, weakest to strongest:

1. Built-in component defaults
2. **Theme** `componentDefaults`
3. **Document** `props.componentDefaults` (deep-merged on top of the theme's)
4. Props set **on the component itself**

Merging is a deep merge: nested objects merge key-by-key with the stronger layer winning, arrays are replaced wholesale.

```json
{
  "name": "docx",
  "props": {
    "theme": "minimal",
    "componentDefaults": {
      "table": {
        "repeatHeaderOnPageBreak": true,
        "cellDefaults": { "padding": 6 }
      }
    }
  },
  "children": [
    {
      "name": "section",
      "props": {},
      "children": [
        {
          "name": "table",
          "props": {
            "repeatHeaderOnPageBreak": false,
            "columns": [
              {
                "header": { "content": "Metric" },
                "cells": [{ "content": "Revenue" }]
              },
              {
                "header": { "content": "Value" },
                "cells": [{ "content": "1.2M" }]
              }
            ]
          }
        }
      ]
    }
  ]
}
```

Here every table inherits 6-point cell padding and repeating headers from the document defaults, but this particular table opts back out of header repetition.

Available keys differ per format:

- **DOCX**: `heading`, `paragraph`, `image`, `statistic`, `table`, `section`, `columns`, `list`
- **PPTX**: `text`, `image`, `shape`, `table`, `highcharts`, `chart`

## Using style presets

### PPTX: the `style` prop

Text components reference one of the seven preset names (`title`, `subtitle`, `heading1`, `heading2`, `heading3`, `body`, `caption`) via `style`. The cascade is: component props → style preset → theme `defaults`. Anything you set inline wins over the preset:

```json
{
  "name": "text",
  "props": { "text": "Roadmap", "style": "heading1", "color": "accent" }
}
```

`title` and `heading*` styles use the theme's heading font face; the others use the body font. Custom themes may override any subset of the seven presets under `styles` — unlisted presets keep their built-in definitions.

### DOCX: real Word styles and `themeStyle`

A DOCX theme's `styles` block (`normal`, `heading1`–`heading6`, `title`, `subtitle`, `TOC1`–`TOC6`, plus arbitrary custom names) is compiled into **real Word paragraph styles** in the output file — heading components pick up `heading1`–`heading6` automatically, and readers see the styles in Word's style gallery. A paragraph can opt into any named style with `themeStyle`:

```json
{
  "name": "paragraph",
  "props": { "text": "A closing thought.", "themeStyle": "subtitle" }
}
```

::: tip
Because DOCX styles become native Word styles, documents stay editable after generation: someone tweaking the file in Word inherits your typography instead of fighting direct formatting.
:::

## Where to go next

- [Theme schema reference](/reference/theme-schema) — every field of both theme file formats
- [Fonts](/guide/fonts) — safe fonts, substitution, registering custom typefaces
- [Writing DOCX](/guide/writing-docx) and [Writing PPTX](/guide/writing-pptx) — theming in the context of full documents
- [CLI reference](/reference/cli) — all `--theme` / `--theme-path` details
