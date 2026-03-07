import { generateDocumentFromJson } from '../core/generator';
import { Packer } from 'docx';
import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Test document with different spacing values
const testDocument = {
  type: 'report',
  config: {
    title: 'Spacing Debug Test',
    subtitle: 'Testing spacing interpretation',
    author: 'Test',
    date: '2025-01-06',
    theme: 'modern',
  },
  modules: [
    {
      type: 'section',
      config: {
        title: 'Spacing Tests',
      },
      modules: [
        {
          type: 'text',
          config: {
            content: 'This should have 6 points spacing (120 twips internally)',
            spacing: {
              before: 6,
              after: 6,
            },
          },
        },
        {
          type: 'text',
          config: {
            content:
              'This should have 12 points spacing (240 twips internally)',
            spacing: {
              before: 12,
              after: 12,
            },
          },
        },
        {
          type: 'text',
          config: {
            content:
              'This should have 24 points spacing (480 twips internally)',
            spacing: {
              before: 24,
              after: 24,
            },
          },
        },
      ],
    },
  ],
};

async function testSpacing() {
  console.log('Testing spacing interpretation...');
  console.log('Input values are in POINTS:');
  console.log('- 6 points = 120 twips');
  console.log('- 12 points = 240 twips');
  console.log('- 24 points = 480 twips');

  try {
    const doc = await generateDocumentFromJson(testDocument as any);
    const buffer = await Packer.toBuffer(doc);

    const outputPath = join(__dirname, '../../output/test-spacing-debug.docx');
    writeFileSync(outputPath, buffer);

    console.log(`\n✅ Document generated successfully: ${outputPath}`);
    console.log('\nPlease open the document and verify:');
    console.log('1. The spacing should be reasonable (6pt, 12pt, 24pt)');
    console.log('2. NOT excessive (120pt, 240pt, 480pt)');
  } catch (error) {
    console.error('Error generating document:', error);
  }
}

testSpacing();
