# PPTX charts

json-to-office offers two chart components for slides: `chart`, which produces **native PowerPoint charts** (editable in PowerPoint, vector-scalable, no external dependencies), and `highcharts`, which renders any Highcharts configuration to a PNG via a Highcharts Export Server and embeds it as an image. For guidance on choosing between them, see the [Charts guide](/guide/charts).

## `chart` — native PowerPoint charts

Native charts are real PowerPoint chart objects: recipients can restyle them, edit the underlying data, and they scale crisply at any zoom level. No server or network access is needed.

### Chart types

`type` is required and must be one of **9 types**:

`area` | `bar` | `bar3D` | `bubble` | `doughnut` | `line` | `pie` | `radar` | `scatter`

### Data

`data` is required: an array (min 1) of series objects.

| Field    | Type     | Description                         |
| -------- | -------- | ----------------------------------- |
| `name`   | string   | Series name (shown in the legend)   |
| `labels` | string[] | Category labels                     |
| `values` | number[] | Data points, one per label          |
| `sizes`  | number[] | Bubble sizes — `bubble` charts only |

```json
{
  "name": "chart",
  "props": {
    "type": "bar",
    "data": [
      {
        "name": "2025",
        "labels": ["Q1", "Q2", "Q3", "Q4"],
        "values": [120, 135, 150, 170]
      },
      {
        "name": "2026",
        "labels": ["Q1", "Q2", "Q3", "Q4"],
        "values": [140, 160, 180, 210]
      }
    ],
    "showLegend": true,
    "legendPos": "b",
    "grid": { "column": 0, "row": 1, "columnSpan": 8, "rowSpan": 4 }
  }
}
```

::: warning Series requirements
Every series must include both `labels` and `values` — a series missing either triggers a `CHART_INVALID_SERIES` warning and the chart is skipped. `pie` and `doughnut` charts accept a single series: passing more warns `CHART_MULTI_SERIES` and only the first series renders.
:::

### Options

All optional. Grouped by concern:

**Display toggles**

| Prop          | Type    | Description                         |
| ------------- | ------- | ----------------------------------- |
| `showLegend`  | boolean | Show the legend                     |
| `showTitle`   | boolean | Show the chart title                |
| `showValue`   | boolean | Show data values on the chart       |
| `showPercent` | boolean | Show percentages (pie/doughnut)     |
| `showLabel`   | boolean | Show category labels on data points |
| `showSerName` | boolean | Show series names on data points    |

**Title**

| Prop            | Type        | Description                   |
| --------------- | ----------- | ----------------------------- |
| `title`         | string      | Chart title text              |
| `titleFontSize` | number (pt) | Title size                    |
| `titleColor`    | string      | Title color (hex or semantic) |
| `titleFontFace` | string      | Title font                    |

**Colors**

| Prop          | Type     | Default       | Description                                        |
| ------------- | -------- | ------------- | -------------------------------------------------- |
| `chartColors` | string[] | theme palette | Series colors — hex values or semantic theme names |

When `chartColors` is unset, the chart uses the theme's 6-slot palette: `['primary', 'secondary', 'accent', 'accent4', 'accent5', 'accent6']`. This means charts automatically follow whichever [theme](/guide/themes) the document uses — re-render with a different theme and the palette follows. It is the same token list, in the same order, that `highcharts` resolves in pptx and in docx alike.

Slots the theme leaves unset are **skipped**: the resolved palette is only as long as the theme has tokens defined, and no `THEME_COLOR_FALLBACK` warning is emitted. Skipping compacts, so a theme with `accent5` but no `accent4` resolves to four colors and `accent5` paints the fourth series. All three built-in pptx themes fill every slot, so this only comes up with a custom theme. The docx `highcharts` component skips an unset slot the same way, so a theme with holes produces the same series colors in both formats; see [Charts](/guide/charts#theme-palette).

A slot that is _filled_ but resolves to no color — its value names another token that leads nowhere, or a reference cycle — is skipped by the implicit palette too. Only hex reaches PowerPoint, which would otherwise paint the series black without saying anything. If _no_ token resolves, the palette is left unset rather than sent empty, and PowerPoint falls back to its own default colors.

An explicit `chartColors` is resolved differently: an entry naming a slot the theme left unset falls back to `primary` and emits a `THEME_COLOR_FALLBACK` warning, and one naming a slot whose value resolves to nothing falls back to `primary` with an `UNKNOWN_COLOR` warning. Naming a token you never usefully defined is an authoring error rather than a partially filled theme.

**Legend**

| Prop             | Type                                       | Description                                           |
| ---------------- | ------------------------------------------ | ----------------------------------------------------- |
| `legendPos`      | `'b'` \| `'l'` \| `'r'` \| `'t'` \| `'tr'` | Legend position (bottom, left, right, top, top-right) |
| `legendFontSize` | number (pt)                                | Legend text size                                      |
| `legendFontFace` | string                                     | Legend font                                           |
| `legendColor`    | string                                     | Legend text color                                     |

**Category axis**

| Prop                   | Type         | Description                                                     |
| ---------------------- | ------------ | --------------------------------------------------------------- |
| `catAxisTitle`         | string       | Axis title — setting it automatically enables the title display |
| `catAxisHidden`        | boolean      | Hide the axis                                                   |
| `catAxisLabelRotate`   | number (deg) | Rotate labels                                                   |
| `catAxisLabelFontSize` | number (pt)  | Label size                                                      |
| `catAxisLabelColor`    | string       | Label color                                                     |

**Value axis**

| Prop                              | Type    | Description                                                     |
| --------------------------------- | ------- | --------------------------------------------------------------- |
| `valAxisTitle`                    | string  | Axis title — setting it automatically enables the title display |
| `valAxisHidden`                   | boolean | Hide the axis                                                   |
| `valAxisMinVal` / `valAxisMaxVal` | number  | Axis bounds                                                     |
| `valAxisLabelFormatCode`          | string  | Number format, e.g. `"$0.00"` or `"#%"`                         |
| `valAxisMajorUnit`                | number  | Tick interval                                                   |
| `valAxisLabelColor`               | string  | Label color                                                     |

**Bar charts**

| Prop             | Type                                               | Default | Description                               |
| ---------------- | -------------------------------------------------- | ------- | ----------------------------------------- |
| `barDir`         | `'bar'` \| `'col'`                                 | `'col'` | `bar` = horizontal, `col` = vertical      |
| `barGrouping`    | `'clustered'` \| `'stacked'` \| `'percentStacked'` | —       | How multiple series combine               |
| `barGapWidthPct` | number 0–500                                       | —       | Gap between bar groups, as % of bar width |

**Line charts**

| Prop             | Type                                                                                       | Description    |
| ---------------- | ------------------------------------------------------------------------------------------ | -------------- |
| `lineSmooth`     | boolean                                                                                    | Smooth curves  |
| `lineDataSymbol` | `'circle'` \| `'dash'` \| `'diamond'` \| `'dot'` \| `'none'` \| `'square'` \| `'triangle'` | Point markers  |
| `lineSize`       | number (pt)                                                                                | Line thickness |

**Pie / doughnut**

| Prop            | Type         | Description                 |
| --------------- | ------------ | --------------------------- |
| `firstSliceAng` | number 0–359 | Rotation of the first slice |
| `holeSize`      | number 10–90 | Doughnut hole size (%)      |

**Radar**

| Prop         | Type                                     | Description           |
| ------------ | ---------------------------------------- | --------------------- |
| `radarStyle` | `'standard'` \| `'marker'` \| `'filled'` | Radar rendering style |

**Data labels**

| Prop                | Type                                                                                  | Description     |
| ------------------- | ------------------------------------------------------------------------------------- | --------------- |
| `dataLabelColor`    | string                                                                                | Label color     |
| `dataLabelFontSize` | number (pt)                                                                           | Label size      |
| `dataLabelFontFace` | string                                                                                | Label font      |
| `dataLabelFontBold` | boolean                                                                               | Bold labels     |
| `dataLabelPosition` | `'b'` \| `'bestFit'` \| `'ctr'` \| `'l'` \| `'r'` \| `'t'` \| `'inEnd'` \| `'outEnd'` | Label placement |

**Position**

`x`, `y`, `w`, `h` (inches or `"NN%"`) and `grid` — see [Slides & grid](/reference/pptx/slides-and-grid).

### Theme auto-contrast

When unset, `titleColor`, `legendColor`, `catAxisLabelColor`, `valAxisLabelColor`, and `dataLabelColor` all default to the theme's `text` color. On a dark theme, chart text automatically renders light — you only override these when you want something other than the theme's contrast pairing.

### Chart warnings

Chart problems don't abort generation; they surface as [pipeline warnings](/guide/validation):

| Code                   | Trigger                                                           |
| ---------------------- | ----------------------------------------------------------------- |
| `UNKNOWN_CHART_TYPE`   | `type` is not one of the 9 supported types — the chart is skipped |
| `CHART_NO_DATA`        | Empty `data` array — the chart is skipped                         |
| `CHART_INVALID_SERIES` | A series is missing `labels` or `values` — the chart is skipped   |
| `CHART_MULTI_SERIES`   | More than one series on a pie/doughnut — only the first renders   |

---

## `highcharts` — rendered Highcharts images

The `highcharts` component sends a full [Highcharts](https://www.highcharts.com/) configuration to a Highcharts Export Server, receives a PNG back, and embeds it on the slide as an image. You get the entire Highcharts catalog (heatmaps, treemaps, gauges, combined series, annotations…) at the cost of needing a running export server and losing in-PowerPoint editability. See the [Charts guide](/guide/charts) for setup and the [render server](/guide/render-server) for deployment.

| Prop        | Type                    | Default                                         | Description                                                                                                          |
| ----------- | ----------------------- | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `options`   | object                  | **required**                                    | Full Highcharts config, sent verbatim to the server. **Must include `chart.width` and `chart.height`** (numbers, px) |
| `scale`     | number                  | —                                               | Export scale factor (higher = sharper image)                                                                         |
| `serverUrl` | string                  | `http://localhost:7801`                         | Per-component export-server override                                                                                 |
| `resources` | `{ css?, js?, files? }` | —                                               | Extra resources forwarded verbatim to the server — notably `@font-face` CSS so charts render in custom fonts         |
| `x`, `y`    | number \| `"NN%"`       | `0`                                             | Position                                                                                                             |
| `w`, `h`    | number \| `"NN%"`       | from `chart.width`/`chart.height` at 96 px/inch | Rendered size on the slide                                                                                           |
| `grid`      | GridPosition            | —                                               | Grid placement                                                                                                       |

### Server URL resolution

The export-server URL resolves in this order:

1. `props.serverUrl` on the component
2. `services.highcharts.serverUrl` in [`GenerationOptions`](/reference/api) (the CLI and playground populate this from the `HIGHCHARTS_SERVER_URL` environment variable)
3. Default `http://localhost:7801`

Authentication headers can be attached via `services.highcharts.headers` — a static header object, or an async function receiving the request body (useful for signed requests). See [Charts guide → deployed servers](/guide/charts).

### Behavior notes

- The component POSTs `{ infile: options, type: 'png', b64: true, scale, resources? }` to `{serverUrl}/export` and embeds the returned base64 PNG.
- **Node-only**: generation with `highcharts` components throws in browser environments — chart rendering requires server-side fetch to the export server.
- If the server is unreachable, the error message suggests the local quick-start: `npx highcharts-export-server --enableServer true`.
- **Theme palette injection**: when `options.colors` is not set, the theme's chart palette (the same `primary`/`secondary`/`accent`/`accent4`/`accent5`/`accent6` tokens as native charts, and as the docx `highcharts` component) is injected, so every chart path follows the document theme consistently. Unset optional slots — and slots whose value resolves to no color — are dropped rather than padded with `primary`, and no warning is emitted, so the injected array is only as long as the theme has usable tokens and Highcharts wraps it; the docx component does exactly the same ([Charts](/guide/charts#theme-palette)). If nothing resolves, no `colors` key is injected at all and Highcharts uses its own palette. An explicit `options.colors` always wins — nothing is injected and no fallback warning is emitted.

```json
{
  "name": "highcharts",
  "props": {
    "options": {
      "chart": { "type": "column", "width": 800, "height": 500 },
      "title": { "text": "Monthly signups" },
      "xAxis": { "categories": ["Jan", "Feb", "Mar"] },
      "series": [{ "name": "Signups", "data": [140, 210, 260] }]
    },
    "scale": 2,
    "grid": { "column": 2, "row": 1, "columnSpan": 8, "rowSpan": 4 }
  }
}
```

---

## See also

- [Charts guide](/guide/charts) — choosing between the two, local server setup, deployed servers
- [Render server](/guide/render-server) — running the combined export/rasterize service
- [PPTX components](/reference/pptx/components) — text, image, shape, table
- [Theme schema](/reference/theme-schema) — palette slots used by chart defaults
