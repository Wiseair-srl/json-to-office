import { createPresentationGenerator } from '../createPresentationGenerator';
import { exportPluginSchema } from '../schema';
import { weatherComponent } from './weather.component';
import * as fs from 'fs/promises';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import type { PresentationComponentDefinition } from '../../types';

import documentDefinition from './plugin-demo.json';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function runPluginDemo() {
  console.log('PPTX Plugin System Demo\n');

  const generator = createPresentationGenerator({ debug: true }).addComponent(
    weatherComponent
  );

  console.log(
    'Registered components:',
    generator.getComponentNames().join(', ')
  );

  // Validate
  console.log('\nValidating...');
  const validation = generator.validate(
    documentDefinition as PresentationComponentDefinition
  );
  if (validation.valid) {
    console.log('Document is valid');
  } else {
    console.error('Validation failed:');
    validation.errors?.forEach((e) =>
      console.error(`  - ${e.path}: ${e.message}`)
    );
    return;
  }

  // Generate
  console.log('\nGenerating...');
  try {
    const outputDir = path.join(
      __dirname,
      '..',
      '..',
      '..',
      '..',
      '..',
      'output',
      'examples'
    );
    await fs.mkdir(outputDir, { recursive: true });

    const outputPath = path.join(outputDir, 'plugin-demo.pptx');
    const result = await generator.generateFile(
      documentDefinition as PresentationComponentDefinition,
      outputPath
    );

    if (result.warnings.length > 0) {
      console.log(`\n${result.warnings.length} warning(s):`);
      result.warnings.forEach((w) =>
        console.log(`  - [${w.component ?? w.code}] ${w.message}`)
      );
    }

    console.log(`Saved to: ${outputPath}`);

    // Schema
    const schemaPath = path.join(outputDir, 'plugin-demo-pptx-schema.json');
    await exportPluginSchema([weatherComponent], schemaPath);
    console.log(`Schema saved to: ${schemaPath}`);
  } catch (error) {
    console.error('Error:', error);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runPluginDemo().catch(console.error);
}

export { runPluginDemo };
export { weatherComponent } from './weather.component';
