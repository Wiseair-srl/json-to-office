import { Packer } from 'docx';
import { createDocumentGenerator } from '../createDocumentGenerator';
import { exportPluginSchema } from '../schema';
import { weatherComponent } from './weather.component';
import { columnsLayoutComponent } from './columns-layout.component';
import { nestedSectionsComponent } from './nested-section.component';
import * as fs from 'fs/promises';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import type { ReportComponentDefinition } from '../../types';

// Import minimal theme
import { minimalTheme } from '../../templates/themes';

// Import the document definition
import documentDefinition from './plugin-demo.json';

// Get __dirname equivalent for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Demo application showing how to use the plugin system
 */
async function runPluginDemo() {
  console.log('🚀 JSON to DOCX Plugin System Demo\n');

  // Create a document generator with our custom components using the builder pattern
  console.log('📦 Creating document generator with custom components...');
  const generator = createDocumentGenerator({
    theme: minimalTheme,
    debug: true, // Enable debug logging
  })
    .addComponent(weatherComponent)
    .addComponent(columnsLayoutComponent)
    .addComponent(nestedSectionsComponent);

  console.log('✅ Registered components:', generator.getComponentNames().join(', '));

  // Validate the document
  console.log('\n📋 Validating document...');
  const validation = generator.validate(
    documentDefinition as ReportComponentDefinition
  );
  if (validation.valid) {
    console.log('✅ Document is valid!');
  } else {
    console.error('❌ Document validation failed:');
    validation.errors?.forEach((error) => {
      console.error(`  - ${error.path}: ${error.message}`);
    });
    return;
  }

  // Generate the document
  console.log('\n📄 Generating document...');
  try {
    const result = await generator.generate(
      documentDefinition as ReportComponentDefinition
    );

    // Log warnings if any
    if (result.warnings && result.warnings.length > 0) {
      console.log(`\n⚠️  ${result.warnings.length} warning(s) generated:`);
      result.warnings.forEach((warning) => {
        console.log(`  - [${warning.component}] ${warning.message}`);
        if (warning.context) {
          console.log(`    Context: ${JSON.stringify(warning.context)}`);
        }
      });
    }

    // Save to file in output/examples directory
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

    const outputPath = path.join(outputDir, 'plugin-demo.docx');
    const buffer = await Packer.toBuffer(result.document);
    await fs.writeFile(outputPath, new Uint8Array(buffer));

    console.log(`✅ Document saved to: ${outputPath}`);

    // Also save the JSON schema
    const schemaPath = path.join(outputDir, 'plugin-demo-schema.json');
    await exportPluginSchema(
      [weatherComponent, columnsLayoutComponent, nestedSectionsComponent],
      schemaPath
    );
    console.log(`✅ Schema saved to: ${schemaPath}`);
  } catch (error) {
    console.error('❌ Error generating document:', error);
  }
}

// Run the demo if this file is executed directly
// ES module equivalent of require.main === module
if (import.meta.url === `file://${process.argv[1]}`) {
  runPluginDemo().catch(console.error);
}

export { runPluginDemo };
