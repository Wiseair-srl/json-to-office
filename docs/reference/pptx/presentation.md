# Presentation & slide reference

Complete reference for the two container components of a PPTX document: the `pptx` root and its `slide` children. For the content components that live inside slides, see [PPTX components](/reference/pptx/components) and [PPTX charts](/reference/pptx/charts); for grid placement and templates in depth, see [Slides & the grid](/reference/pptx/slides-and-grid).

## Component shape

Every component in the tree is an object of the form:

```json
{
  "name": "pptx",
  "id": "optional-id",
  "enabled": true,
  "props": {},
  "children": []
}
```

| Field      | Type                           | Required            | Description                                                                                                                                                        |
| ---------- | ------------------------------ | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `name`     | string                         | yes                 | Component type. The root must be `"pptx"`.                                                                                                                         |
| `renderer` | `"pptxgenjs" \| "office-open"` | root only, no       | Backend compatibility profile. Omitted means `pptxgenjs`. Generation options override this field.                                                                  |
| `id`       | string                         | no                  | Free-form identifier, useful for tooling.                                                                                                                          |
| `enabled`  | boolean                        | no (default `true`) | When `false`, the component is filtered out and not rendered — content components, template objects and `slide` components alike. See [`enabled`](#enabled) below. |
| `props`    | object                         | per component       | Component properties (tables below).                                                                                                                               |
| `children` | array                          | containers only     | `pptx` accepts only `slide` children; `slide` accepts only content components; content components must not carry `children`.                                       |

The root component additionally allows a `$schema` field, so editors can wire up JSON Schema autocompletion (see [JSON schemas](/reference/json-schemas)). The schema uses `renderer` to select its backend-specific branch. Both `pptx` props and `slide` props reject unknown keys (`additionalProperties: false`) — the deep validator reports them as errors unless you opt into `allowUnknownFields` (see [Validation](/guide/validation)).

### `enabled`

`enabled` sits alongside `props`, not inside it, and is declared on every component type — including `slide`. Omitting it means enabled; only the explicit value `false` removes a component:

```json
{
  "name": "slide",
  "enabled": false,
  "props": { "notes": "Held back until the pricing review lands" },
  "children": []
}
```

A disabled slide is never written into the file. Two consequences follow:

- **Slide numbers are computed after the drop.** `{PAGE_NUMBER}` / `{PAGE_COUNT}` and PowerPoint's native slide numbers count only the emitted slides, so a three-slide deck with the middle slide disabled renders as `1/2` and `2/2`.
- **`hyperlink.slide` is rebased, not broken.** The internal-link target on `text` and `image` is a 1-based index over the **authored** slides, disabled slides included; generation remaps it onto the emitted slide numbering, so the link keeps pointing at the slide the author meant. If the target is itself disabled, or the index falls outside the authored range, the link is dropped and a `HYPERLINK_SLIDE_UNRESOLVED` warning is reported — rather than written as a relationship to a slide that is not in the file, which PowerPoint reports as a damaged package. Remapping covers every place a slide ref can be authored: slide children, slide `placeholders`, template `objects`, and a template placeholder's `defaults`. A `hyperlink.url` outranks `slide` and is never touched.

To keep a slide in the file but skip it during the slideshow, use the slide prop [`hidden`](#notes-and-hidden) instead.

## Root `pptx` props

| Prop                | Type                   | Default                              | Description                                                                                                                                                                                                    |
| ------------------- | ---------------------- | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `title`             | string                 | —                                    | Presentation title (file metadata).                                                                                                                                                                            |
| `author`            | string                 | —                                    | Author (file metadata).                                                                                                                                                                                        |
| `subject`           | string                 | —                                    | Subject (file metadata).                                                                                                                                                                                       |
| `company`           | string                 | —                                    | Company (file metadata).                                                                                                                                                                                       |
| `theme`             | string \| theme object | `"default"`                          | Name of a built-in/custom theme, **or** a full inline theme object. See below.                                                                                                                                 |
| `slideWidth`        | number (inches)        | `10`                                 | Slide width. Use `13.33` for 16:9.                                                                                                                                                                             |
| `slideHeight`       | number (inches)        | `7.5`                                | Slide height.                                                                                                                                                                                                  |
| `rtlMode`           | boolean                | `false`                              | Right-to-left text mode for the whole presentation.                                                                                                                                                            |
| `language`          | string (BCP-47)        | —                                    | Default spell-check language, e.g. `"en-US"`, `"it-IT"`. Pattern `^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$`. Individual `text` components can override it; when unset, the underlying engine falls back to `en-US`. |
| `pageNumberFormat`  | `"9"` \| `"09"`        | `"9"`                                | Formatting of `{PAGE_NUMBER}` / `{PAGE_COUNT}` placeholders in text: `"09"` zero-pads numbers to the width of the total slide count.                                                                           |
| `componentDefaults` | object                 | —                                    | Per-type default props applied to every component of that type. See below.                                                                                                                                     |
| `grid`              | GridConfig             | 12 × 6, 0.5 in margin, 0.2 in gutter | Presentation-wide grid configuration — see [Slides & the grid](/reference/pptx/slides-and-grid).                                                                                                               |
| `blocks`            | Record<string, block>  | —                                    | Document-local JSON block definitions, invoked on slides with `name: "block"` — see [JSON blocks](/reference/blocks#pptx).                                                                                     |

All props are optional; a bare `{ "name": "pptx", "children": [...] }` is a valid document.

### Metadata

`title`, `author`, `subject`, and `company` map directly onto the PowerPoint file's document properties (visible in File → Info). They have no visual effect on slides.

### `theme` — named or inline

As a **string**, `theme` selects a built-in theme (`default`, `dark`, `minimal`) or a custom theme supplied through `GenerationOptions.customThemes`. Unknown names fall back to the default theme.

As an **object**, `theme` embeds the entire theme configuration in the document itself — colors, fonts, defaults, style presets, and component defaults (full field list in the [theme schema reference](/reference/theme-schema)):

```json
{
  "name": "pptx",
  "props": {
    "theme": {
      "name": "brand",
      "colors": {
        "primary": "#1A2B4C",
        "secondary": "#4C6EF5",
        "accent": "#12B886",
        "background": "#FFFFFF",
        "text": "#1A1A2E"
      },
      "fonts": { "heading": "Georgia", "body": "Arial" },
      "defaults": { "fontSize": 14, "fontColor": "#1A1A2E" }
    }
  },
  "children": []
}
```

**Inline-theme normalization**: at generation time an object `theme` is lifted into the custom-theme registry under its own `name` (or `"inline-theme"` when the name is missing), so every downstream mechanism that works with named themes — semantic color resolution, style presets, chart palettes — behaves identically. The document remains fully self-contained: no side files, no registration code.

### `slideWidth` / `slideHeight`

Slide dimensions in inches, registered as a custom layout. Defaults produce a 4:3 deck (10 × 7.5); the standard widescreen 16:9 format is 13.33 × 7.5. All positioning in the document — explicit coordinates, percentages, and grid resolution — is computed against these dimensions.

### `language` and `pageNumberFormat`

`language` sets the proofing language on all text so spell-check underlines behave correctly in the viewer's PowerPoint. A `text` component can override it per box via its own `language` prop.

`pageNumberFormat` affects only the `{PAGE_NUMBER}` and `{PAGE_COUNT}` text placeholders: with `"09"`, slide 3 of 12 renders as `03` / `12`-width padding; with the default `"9"` it renders as `3`.

### `componentDefaults`

A per-type map of default props, each entry a partial of that component's props:

```json
{
  "componentDefaults": {
    "text": { "fontFace": "Inter", "fontSize": 14 },
    "table": { "fontSize": 12, "align": "left" },
    "chart": { "showLegend": true, "legendPos": "b" }
  }
}
```

Supported keys: `text`, `image`, `shape`, `table`, `highcharts`, `chart`. Themes can define `componentDefaults` too; presentation-level defaults merge **on top of** theme-level ones, and a component's own props always win. Inside template placeholders the full precedence chain also includes placeholder defaults — see [Slides & the grid](/reference/pptx/slides-and-grid).

## Slide props

| Prop         | Type                 | Default | Description                                                                                                                                                                                  |
| ------------ | -------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `meta`       | `{ title? }`         | —       | Authoring metadata; never rendered. `meta.title` labels the slide in editors and outlines (e.g. the playground sidebar), overriding the label otherwise derived from the slide's title text. |
| `background` | `{ color?, image? }` | —       | Slide background. `color` is a hex value or semantic theme name; `image` is `{ path? }` or `{ base64? }`.                                                                                    |
| `transition` | `{ type?, speed? }`  | —       | Slide transition. `type`: `fade` \| `push` \| `wipe` \| `zoom` \| `none`; `speed`: `slow` \| `medium` \| `fast`. Supported by `office-open` only.                                            |
| `notes`      | string               | —       | Speaker notes, shown in presenter view.                                                                                                                                                      |
| `hidden`     | boolean              | —       | `true` marks the slide as hidden: it stays in the file but is skipped during the slideshow.                                                                                                  |

All props are optional; unknown keys and props outside the selected renderer profile are rejected. Transitions are `office-open`-only. The native `chart` component is drawn by both renderers, except `bubble`, which is `pptxgenjs`-only; `highcharts` keeps its full catalog on both.

### `background`

```json
{ "name": "slide", "props": { "background": { "color": "primary" } } }
```

```json
{
  "name": "slide",
  "props": { "background": { "image": { "path": "./assets/cover.jpg" } } }
}
```

Background colors go through the same resolution as all colors: semantic names (`primary`, `background2`, ...) resolve against the active theme, hex values pass through as-is. Templates can also define a background; a slide using a template typically leaves `background` unset and inherits it.

### `notes` and `hidden`

```json
{
  "name": "slide",
  "props": {
    "notes": "Walk through the chart left to right. Mention the Q3 pricing change.",
    "hidden": true
  },
  "children": []
}
```

`notes` accepts plain text (use `\n` for line breaks). `hidden` slides are a good home for appendix material you want in the file but not in the live run — contrast with [`enabled: false`](#enabled), which drops the slide from the file altogether.

### Blocks on a slide

```json
{
  "name": "slide",
  "children": [
    {
      "name": "block",
      "props": {
        "ref": "action-chart",
        "slots": {
          "title": "Revenue grew 18% as on-time delivery reached 94%",
          "chart": { "name": "chart", "props": { "type": "bar", "data": [] } },
          "source": "Source: quarterly operating review, 2026."
        }
      }
    }
  ]
}
```

A `block` invokes a definition from the root `props.blocks` and supplies content through its named slots — nothing else: an invocation accepts no coordinates, and a component placed in a slot may not carry `x`/`y`/`w`/`h` or `grid`. The definition owns the geometry; it expands into a transparent `group` of ordinary slide content, and a definition may hand its slide a background, speaker notes and a grid the slide did not state itself. A `block` sits beside coordinate-authored components on the same slide. The contract, the layout operations and the reference catalog are documented in [JSON blocks](/reference/blocks#pptx); groups and frames in [Slides & the grid](/reference/pptx/slides-and-grid).

## Minimal complete document

```json
{
  "name": "pptx",
  "props": {
    "title": "Demo",
    "theme": "default",
    "slideWidth": 13.33,
    "slideHeight": 7.5
  },
  "children": [
    {
      "name": "slide",
      "props": {
        "background": { "color": "background" },
        "notes": "Speaker notes here"
      },
      "children": [
        {
          "name": "text",
          "props": {
            "text": "Hello",
            "style": "title",
            "grid": { "column": 0, "row": 0, "columnSpan": 12, "rowSpan": 2 }
          }
        },
        {
          "name": "chart",
          "props": {
            "type": "line",
            "data": [
              { "name": "Users", "labels": ["Jan", "Feb"], "values": [1, 2] }
            ],
            "grid": { "column": 0, "row": 2, "columnSpan": 12, "rowSpan": 4 }
          }
        }
      ]
    }
  ]
}
```
