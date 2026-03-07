/**
 * Test Spacing Example
 * Generate document to test that spacing values are in points
 */

import { generateDocumentFromJson } from '../core/generator';
import { join, dirname } from 'path';
import { readFileSync, writeFileSync } from 'fs';
import { Packer } from 'docx';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function generateTestSpacingDocument() {
  const jsonPath = join(__dirname, 'test-spacing.json');
  const outputPath = join(__dirname, '../../output/test-spacing.docx');

  console.log('Generating test spacing document...');
  console.log('Reading JSON from:', jsonPath);

  const jsonContent = JSON.parse(readFileSync(jsonPath, 'utf-8'));

  const document = await generateDocumentFromJson(jsonContent);
  const buffer = await Packer.toBuffer(document);
  writeFileSync(outputPath, buffer);

  console.log('Document generated successfully at:', outputPath);
  console.log('\nSpacing values used:');
  console.log('- Text paragraph 1: 12 points before/after');
  console.log('- Text paragraph 2: 24 points before/after');
  console.log('- Text-space-after 1: 18 points after');
  console.log('- Text-space-after 2: 12 points after (default)');
  console.log('- List: 12 points before/after, 6 points between items');
}

generateTestSpacingDocument().catch(console.error);
