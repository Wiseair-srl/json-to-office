# Examples

Real-world JSON document definitions you can render with json-to-office.

| File                                                         | Format | Description                                                                                                                         |
| ------------------------------------------------------------ | ------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| [invoice.docx.json](invoice.docx.json)                       | DOCX   | Northvane Studio invoice with line items, payment instructions, and retainer terms                                                  |
| [contract-v1.docx.json](contract-v1.docx.json)               | DOCX   | Service agreement (base version) — diff it against v2 for a tracked-change redline                                                  |
| [contract-v2.docx.json](contract-v2.docx.json)               | DOCX   | Service agreement (revised version) for `jto docx diff`                                                                             |
| [visual-infographic.docx.json](visual-infographic.docx.json) | DOCX   | `visual` component — a free-canvas chevron infographic authored as a pptx slide and embedded as a PNG (needs LibreOffice + poppler) |
| [native-visual.docx.json](native-visual.docx.json)           | DOCX   | The same infographic drawn natively (`renderMode: "native"` + the `office-open` renderer) — editable shapes and text, no rasterizer |
| [quarterly-review.pptx.json](quarterly-review.pptx.json)     | PPTX   | Two-slide quarterly review with grid layout, semantic theme colors, a native chart, a table, and speaker notes                      |

More templates are available in the visual playground — run `jto pptx dev` or `jto docx dev` to browse the full gallery.

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
