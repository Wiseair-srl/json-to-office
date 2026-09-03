# Examples

Real-world JSON document definitions you can render with json-to-office.

| File                                                         | Format | Description                                                                                                                                     |
| ------------------------------------------------------------ | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| [invoice.docx.json](invoice.docx.json)                       | DOCX   | Northvane Studio invoice — SVG brand band, meta strip, styled line items, and payment terms                                                     |
| [contract-v1.docx.json](contract-v1.docx.json)               | DOCX   | Service agreement (base version) with letterhead and signature block — diff it against v2 for a tracked-change redline                          |
| [contract-v2.docx.json](contract-v2.docx.json)               | DOCX   | Service agreement (revised version) for `jto docx diff`                                                                                         |
| [visual-infographic.docx.json](visual-infographic.docx.json) | DOCX   | `visual` component — a free-canvas chevron infographic authored as a pptx slide and embedded as a PNG (needs LibreOffice + poppler)             |
| [native-visual.docx.json](native-visual.docx.json)           | DOCX   | The same infographic drawn natively (`renderMode: "native"` + the `office-open` renderer) — editable shapes and text, no rasterizer             |
| [native-chart.docx.json](native-chart.docx.json)             | DOCX   | Native Word charts (`chart` + the `office-open` renderer) — real chart objects with an embedded workbook, editable in Word, no export server    |
| [highcharts-report.docx.json](highcharts-report.docx.json)   | DOCX   | `highcharts` charts drawn through a Highcharts Export Server — the theme palette carries, the theme fonts do not (see the Claude Desktop guide) |
| [quarterly-review.pptx.json](quarterly-review.pptx.json)     | PPTX   | Two-slide quarterly review — designed title and dashboard slides with KPI tiles, a native chart, a styled table, and speaker notes              |

Every example shares one design system — the vermilion editorial language of the `vermilion-annual-report` stock template (and its bundled `vermilion` docx theme): poster-red display headings, ink text, warm creams and hairline rules. More templates are available in the visual playground — run `jto pptx dev` or `jto docx dev` to browse the full gallery.

> **Note** — `highcharts-report.docx.json` needs a Highcharts Export Server on the host (`npx highcharts-export-server --enableServer true`, listening on `:7801`). Generation fails outright when none is answering rather than dropping the chart, which is deliberate: a document that quietly lost its figures is worse than one that was not produced. `native-chart.docx.json` is the same idea with no server at all.

> **Note** — `visual` components rasterize a pptx slide to PNG at build time, which requires **LibreOffice** (`soffice`) and **poppler** (`pdftoppm`) on the host. The `jto` CLI wires this up automatically; point at a remote rasterizer with `JTO_PPTX_RASTERIZER_URL` instead. A visual with `"renderMode": "native"` needs none of that — it is drawn by the `office-open` backend itself.

## Render an example

```bash
# With the CLI
pnpm add --global @json-to-office/jto
jto docx generate ./invoice.docx.json -o ./invoice.docx
jto pptx generate ./quarterly-review.pptx.json -o ./quarterly-review.pptx

# Diff two versions into a redline with native Word tracked changes
jto docx diff ./contract-v1.docx.json ./contract-v2.docx.json -o ./redline.docx

# Or open in the visual playground
jto docx dev
```

Every example is validated in CI. The invoice and quarterly review are also rendered as smoke tests, so these two files are kept dependency-free and runnable on a plain Node.js host.

## Render programmatically

```ts
import { generateBufferFromJson } from '@json-to-office/json-to-docx';
import { readFileSync, writeFileSync } from 'fs';

const definition = JSON.parse(readFileSync('./invoice.docx.json', 'utf-8'));
writeFileSync('invoice.docx', await generateBufferFromJson(definition));
```
