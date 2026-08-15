# Charts

json-to-office gives you two ways to put charts in a document: **native PowerPoint charts** (the pptx `chart` component) and **Highcharts-rendered images** (the `highcharts` component, available in both pptx and docx). This page helps you choose between them and get each one running.

## Native charts vs Highcharts

|                        | `chart` (native, pptx only)                                            | `highcharts` (pptx + docx)                                                               |
| ---------------------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Output                 | Real PowerPoint chart object                                           | PNG image                                                                                |
| Editable by recipients | Yes — data and styling editable in PowerPoint                          | No — it's a picture                                                                      |
| Scaling                | Vector, crisp at any zoom                                              | Raster (use `scale` for sharper exports)                                                 |
| External dependencies  | None                                                                   | Requires a running Highcharts Export Server                                              |
| Works in the browser   | Yes                                                                    | No — Node-only (needs server-side fetch)                                                 |
| Chart catalog          | 9 types: area, bar, bar3D, bubble, doughnut, line, pie, radar, scatter | The full Highcharts catalog: heatmaps, treemaps, gauges, combined series, annotations, … |
| Theme integration      | Palette + text colors follow the theme automatically                   | Theme palette injected when `options.colors` unset                                       |

**Rule of thumb**: reach for native `chart` first. It needs no infrastructure, recipients can tweak it, and it covers the common business-chart types. Reach for `highcharts` when you need chart types or styling that PowerPoint charts can't express — or when you're generating a Word document, where `highcharts` is the chart component.

Both paths default their series colors to the theme palette, so charts recolor themselves when you switch [themes](/guide/themes). The palettes differ by format: in PPTX — native `chart` and `highcharts` alike — the default set is `primary`, `secondary`, `accent`, `accent4`, `accent5`, `accent6`; the DOCX `highcharts` component injects the first three only (`primary`, `secondary`, `accent`). In both cases an explicit `options.colors` always wins.

## Quick examples

### Native pptx chart

No server needed — this renders anywhere:

```json
{
  "name": "chart",
  "props": {
    "type": "line",
    "data": [
      {
        "name": "Users",
        "labels": ["Jan", "Feb", "Mar", "Apr"],
        "values": [120, 180, 260, 390]
      }
    ],
    "title": "Monthly active users",
    "showTitle": true,
    "showLegend": false,
    "lineSmooth": true,
    "grid": { "column": 0, "row": 1, "columnSpan": 12, "rowSpan": 4 }
  }
}
```

Every series needs both `labels` and `values`; pie and doughnut charts take a single series. The full option set (axes, legend, data labels, bar/line/pie specifics) is in the [pptx charts reference](/reference/pptx/charts).

### pptx `highcharts`

The `options` object is a standard Highcharts configuration, and it **must include `chart.width` and `chart.height`** in pixels — the export server needs fixed dimensions to render. On the slide, position with `x`/`y`/`w`/`h` (inches or `%`) or `grid`; when omitted, size defaults to the chart's pixel dimensions at 96 px/inch.

```json
{
  "name": "highcharts",
  "props": {
    "options": {
      "chart": { "type": "column", "width": 800, "height": 500 },
      "title": { "text": "Revenue by region" },
      "xAxis": { "categories": ["EMEA", "APAC", "AMER"] },
      "series": [
        { "name": "2025", "data": [1.2, 0.8, 2.1] },
        { "name": "2026", "data": [1.4, 1.1, 2.6] }
      ]
    },
    "grid": { "column": 1, "row": 1, "columnSpan": 10, "rowSpan": 4 }
  }
}
```

### docx `highcharts`

The same component exists for Word documents. Instead of slide coordinates it takes optional `width`/`height` (pixels, or a `"90%"` string relative to content width) for the rendered image size. It lives inside a `section` like any other docx block:

```json
{
  "name": "docx",
  "props": { "theme": "default" },
  "children": [
    {
      "name": "section",
      "children": [
        { "name": "heading", "props": { "text": "Results", "level": 2 } },
        {
          "name": "highcharts",
          "props": {
            "options": {
              "chart": { "type": "pie", "width": 600, "height": 400 },
              "series": [
                {
                  "name": "Share",
                  "data": [
                    { "name": "Product A", "y": 61 },
                    { "name": "Product B", "y": 39 }
                  ]
                }
              ]
            },
            "width": "80%"
          }
        }
      ]
    }
  ]
}
```

See [DOCX components](/reference/docx/components) for the docx-side props.

## Running the export server locally

The `highcharts` component talks to a [Highcharts Export Server](https://github.com/highcharts/node-export-server) over HTTP. For local development, run one with `pnpm dlx`:

```bash
pnpm dlx highcharts-export-server --enableServer true
```

It listens on `http://localhost:7801` by default — which is exactly where json-to-office looks when no server URL is configured. Start the server, generate your document, done:

```bash
pnpm dlx highcharts-export-server --enableServer true &
pnpm dlx @json-to-office/jto pptx generate report.pptx.json -o report.pptx
```

::: tip
The export server uses Puppeteer/Chromium under the hood, so the first run downloads a browser. If a document with `highcharts` components fails with a connection error, the message will remind you of the command above.
:::

## Pointing at a deployed server

For CI or production you'll usually run the export server as a service — the project's own [render server](/guide/render-server) bundles a Highcharts Export Server behind an `/export` endpoint, ready to deploy.

The server URL resolves per component in this order:

1. `serverUrl` prop on the individual `highcharts` component
2. `services.highcharts.serverUrl` from generation options / environment
3. Default `http://localhost:7801`

### Library

Pass a `services` config to any generation call:

```ts
import { generateAndSaveFromJson } from '@json-to-office/json-to-pptx';

await generateAndSaveFromJson(document, 'report.pptx', {
  services: {
    highcharts: {
      serverUrl: 'https://charts.example.com',
    },
  },
});
```

The same `services` option exists on `@json-to-office/json-to-docx` generation calls and on the plugin-system generators.

### CLI and playground

The [CLI](/guide/cli) and [playground](/guide/playground) read the server URL from the environment:

```bash
export HIGHCHARTS_SERVER_URL=https://charts.example.com
pnpm dlx @json-to-office/jto pptx generate report.pptx.json -o report.pptx
```

### Authentication headers

If your export server sits behind an API key or gateway, attach headers via `services.highcharts.headers`. Headers can be a static object or an async function that receives the request body (for signed requests):

```ts
await generateAndSaveFromJson(document, 'report.pptx', {
  services: {
    highcharts: {
      serverUrl: 'https://charts.example.com',
      headers: { 'x-api-key': process.env.CHARTS_API_KEY! },
      // or computed per request:
      // headers: async (body) => ({ Authorization: `Bearer ${await getToken(body)}` }),
    },
  },
});
```

On the CLI, set `HIGHCHARTS_API_KEY` (and optionally `HIGHCHARTS_API_KEY_HEADER`, default `x-api-key`) and the header is attached for you:

```bash
export HIGHCHARTS_SERVER_URL=https://charts.example.com
export HIGHCHARTS_API_KEY=sk-...
```

## Custom fonts in Highcharts output

The `resources` prop is forwarded verbatim to the export server, which lets you inject `@font-face` CSS (plus JS or extra files) so exported charts render in your brand font:

```json
{
  "name": "highcharts",
  "props": {
    "options": {
      "chart": { "width": 800, "height": 500 },
      "series": [{ "data": [1, 2, 3] }]
    },
    "resources": {
      "css": "@font-face { font-family: 'Inter'; src: url('https://fonts.example.com/inter.woff2'); } .highcharts-root { font-family: 'Inter', sans-serif; }"
    }
  }
}
```

## Next steps

- [PPTX charts reference](/reference/pptx/charts) — every prop on `chart` and `highcharts`
- [Render server](/guide/render-server) — deploy the combined export/rasterize service
- [Themes & styling](/guide/themes) — how the chart palette follows the theme
- [DOCX components](/reference/docx/components) — the docx `highcharts` and `visual` components
