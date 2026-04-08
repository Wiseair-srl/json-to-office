import * as path from 'path';
import * as fs from 'fs/promises';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUTPUT_DIR = path.join(ROOT, 'schemas');

const SHARED = path.join(ROOT, 'packages/shared/dist/index.js');
const SHARED_DOCX = path.join(ROOT, 'packages/shared-docx/dist/index.js');
const SHARED_PPTX = path.join(ROOT, 'packages/shared-pptx/dist/index.js');

async function main() {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });

  const { convertToJsonSchema, exportSchemaToFile } = await import(SHARED);

  // DOCX document schema
  const {
    generateUnifiedDocumentSchema: generateDocx,
    ThemeConfigSchema: DocxThemeSchema,
  } = await import(SHARED_DOCX);

  const docxSchema = generateDocx({
    includeStandardComponents: true,
    includeTheme: false,
    customComponents: [],
    title: 'JSON Document Definition',
    description: 'Document definition with standard components',
  });
  const docxJson = convertToJsonSchema(docxSchema, {
    $id: 'document.schema.json',
  });
  await exportSchemaToFile(
    docxJson,
    path.join(OUTPUT_DIR, 'document.schema.json'),
    {
      prettyPrint: true,
    }
  );
  console.log('Generated schemas/document.schema.json');

  // DOCX theme schema
  const themeJson = convertToJsonSchema(DocxThemeSchema, {
    $id: 'theme.schema.json',
    title: 'Theme Configuration',
    description: 'Theme configuration for styling',
  });
  await exportSchemaToFile(
    themeJson,
    path.join(OUTPUT_DIR, 'theme.schema.json'),
    {
      prettyPrint: true,
    }
  );
  console.log('Generated schemas/theme.schema.json');

  // PPTX presentation schema
  const { generateUnifiedDocumentSchema: generatePptx } = await import(
    SHARED_PPTX
  );
  const pptxSchema = generatePptx({ customComponents: [] });
  const pptxJson = convertToJsonSchema(pptxSchema, {
    $id: 'presentation.schema.json',
  });
  await exportSchemaToFile(
    pptxJson,
    path.join(OUTPUT_DIR, 'presentation.schema.json'),
    {
      prettyPrint: true,
    }
  );
  console.log('Generated schemas/presentation.schema.json');

  console.log('Schema generation complete.');
}

main().catch((err) => {
  console.error('Schema generation failed:', err);
  process.exit(1);
});
