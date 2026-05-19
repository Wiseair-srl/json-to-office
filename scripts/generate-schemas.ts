import * as path from 'path';
import * as fs from 'fs/promises';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUTPUT_DIR = path.join(ROOT, 'schemas');

const SHARED = path.join(ROOT, 'packages/shared/dist/index.js');
const SHARED_DOCX = path.join(ROOT, 'packages/shared-docx/dist/index.js');
const SHARED_PPTX = path.join(ROOT, 'packages/shared-pptx/dist/index.js');

async function main() {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });

  const { convertToJsonSchema, exportSchemaToFile } = await import(
    pathToFileURL(SHARED).href
  );

  // DOCX document schema
  const {
    generateUnifiedDocumentSchema: generateDocx,
    ThemeConfigSchema: DocxThemeSchema,
  } = await import(pathToFileURL(SHARED_DOCX).href);

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
    pathToFileURL(SHARED_PPTX).href
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

  // Mirror schemas into the skill so SKILL.md can reference them via a stable path.
  const SKILL_SCHEMAS = path.join(ROOT, 'skills/json-to-office/assets/schemas');
  try {
    await fs.mkdir(SKILL_SCHEMAS, { recursive: true });
    for (const name of [
      'document.schema.json',
      'presentation.schema.json',
      'theme.schema.json',
    ]) {
      await fs.copyFile(
        path.join(OUTPUT_DIR, name),
        path.join(SKILL_SCHEMAS, name)
      );
    }
    console.log('Mirrored schemas into skills/json-to-office/assets/schemas/');
  } catch (err) {
    // Skill dir may not exist on older branches — non-fatal
    console.warn('Could not mirror schemas to skill:', err);
  }

  console.log('Schema generation complete.');
}

main().catch((err) => {
  console.error('Schema generation failed:', err);
  process.exit(1);
});
