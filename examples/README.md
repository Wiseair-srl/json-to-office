# Examples

Real-world JSON document definitions you can render with json-to-office.

| File                                         | Format | Description                                                                        |
| -------------------------------------------- | ------ | ---------------------------------------------------------------------------------- |
| [invoice.docx.json](invoice.docx.json)       | DOCX   | Northvane Studio invoice with line items, payment instructions, and retainer terms |
| [pitch-deck.pptx.json](pitch-deck.pptx.json) | PPTX   | Meridian Series B deck with grid layout, templates, decorative shapes, and charts  |

More templates are available in the visual playground — run `jto pptx dev` or `jto docx dev` to browse the full gallery.

## Render an example

```bash
# With the CLI
npm install -g @json-to-office/jto
jto docx generate --input ./invoice.docx.json --output ./invoice.docx
jto pptx generate --input ./pitch-deck.pptx.json --output ./deck.pptx

# Or open in the visual playground
jto docx dev --input ./invoice.docx.json
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
