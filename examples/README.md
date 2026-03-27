# Examples

Real-world JSON document definitions you can render with json-to-office.

| File                                               | Format | Description                                                         |
| -------------------------------------------------- | ------ | ------------------------------------------------------------------- |
| [invoice.docx.json](invoice.docx.json)             | DOCX   | Professional invoice with line items, totals, and payment terms     |
| [annual-review.docx.json](annual-review.docx.json) | DOCX   | Multi-section annual review with TOC, statistics, tables, and lists |
| [pitch-deck.pptx.json](pitch-deck.pptx.json)       | PPTX   | Series A pitch deck with KPI cards, charts, and grid layout         |

## Render an example

```bash
# With the CLI
npm install -g @json-to-office/jto
jto docx generate --input ./invoice.docx.json --output ./invoice.docx
jto pptx generate --input ./pitch-deck.pptx.json --output ./deck.pptx

# Or open in the visual playground
jto docx dev --input ./annual-review.docx.json
```

## Render programmatically

```ts
import { generateDocument } from '@json-to-office/json-to-docx';
import { Packer } from 'docx';
import { readFileSync, writeFileSync } from 'fs';

const definition = JSON.parse(readFileSync('./invoice.docx.json', 'utf-8'));
const doc = await generateDocument(definition);
const buffer = await Packer.toBuffer(doc);
writeFileSync('invoice.docx', buffer);
```
