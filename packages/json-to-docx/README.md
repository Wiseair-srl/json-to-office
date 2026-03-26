# @json-to-office/json-to-docx

Generate professional .docx documents from JSON definitions.

## Install

```bash
npm install @json-to-office/json-to-docx docx
```

## Usage

```ts
import { generateDocx } from '@json-to-office/json-to-docx';

const buffer = await generateDocx({
  sections: [
    {
      children: [{ type: 'paragraph', text: 'Hello!' }],
    },
  ],
});
```

## License

[MIT](../../LICENSE)
