# @json-to-office/json-to-pptx

Generate professional .pptx presentations from JSON definitions.

## Install

```bash
npm install @json-to-office/json-to-pptx pptxgenjs
```

## Usage

```ts
import { generatePptx } from '@json-to-office/json-to-pptx';

const buffer = await generatePptx({
  slides: [
    {
      elements: [
        { type: 'text', text: 'Hello!', options: { x: 1, y: 1, w: 8, h: 1 } },
      ],
    },
  ],
});
```

## License

[MIT](../../LICENSE)
