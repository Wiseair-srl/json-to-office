/**
 * Examples registry - JSON-based examples
 * This file provides a unified interface to the JSON examples system
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { ComponentDefinition } from '@json-to-office/shared-docx';

let _dirname: string | null = null;

function getDirname(): string {
  if (_dirname === null) {
    try {
      _dirname = path.dirname(fileURLToPath(import.meta.url));
    } catch {
      throw new Error(
        'Cannot resolve file paths in a bundled environment. Example loading from disk is not available.'
      );
    }
  }
  return _dirname;
}

/**
 * Load a JSON example by name
 */
export function loadJsonExample(name: string): ComponentDefinition {
  // Since this file is bundled into dist/index.js, getDirname() will be the dist directory
  // The JSON files are copied to dist/templates/documents/ by the tsup config
  const filePath = path.join(
    getDirname(),
    'templates',
    'documents',
    `${name}.docx.json`
  );

  try {
    const content = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(content) as ComponentDefinition;
  } catch (error) {
    throw new Error(
      `Failed to load JSON example "${name}": ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Get list of available JSON examples
 */
export function getAvailableJsonExamples(): string[] {
  // Since this file is bundled into dist/index.js, getDirname() will be the dist directory
  // The JSON files are copied to dist/templates/documents/ by the tsup config
  const examplesDir = path.join(getDirname(), 'templates', 'documents');

  try {
    const files = fs.readdirSync(examplesDir);
    return files
      .filter((file) => file.endsWith('.docx.json'))
      .map((file) => path.basename(file, '.docx.json'))
      .sort();
  } catch (error) {
    console.warn('Could not read JSON examples directory:', error);
    return [];
  }
}

/**
 * Example descriptions for documentation
 */
export const EXAMPLE_DESCRIPTIONS: Record<string, string> = {
  a2a: 'A2A company mobility plan document with custom headers and footers',
  'highcharts-demo':
    'Demonstrates Highcharts integration with various chart types (line, column, pie, area, scatter)',
  hitachi: 'Hitachi company mobility plan with custom headers and footers',
  verizon:
    'Real-world example based on Verizon DBIR report with mixed single/two-column layouts',
  columns:
    'Columns config options demo (numeric shorthand, top-level gap, auto widths, per-column gaps)',
};

/**
 * Registry of available JSON examples (lazy-loaded)
 * For backward compatibility, this returns ComponentDefinition objects
 */
const _exampleCache: Record<string, ComponentDefinition> = {};

export const examples = new Proxy({} as Record<string, ComponentDefinition>, {
  get(_target, prop: string) {
    if (!_exampleCache[prop]) {
      try {
        _exampleCache[prop] = loadJsonExample(prop);
      } catch {
        return undefined;
      }
    }
    return _exampleCache[prop];
  },

  ownKeys(_target) {
    return getAvailableJsonExamples();
  },

  has(_target, prop: string) {
    return getAvailableJsonExamples().includes(prop);
  },
});

/**
 * Get example definition by name
 */
export const getExample = (
  exampleName: string
): ComponentDefinition | undefined => {
  return examples[exampleName];
};

/**
 * Get all available example names
 */
export const getExampleNames = (): string[] => {
  return getAvailableJsonExamples();
};

// Use loadJsonExample() directly or access via the examples proxy
export const placeholderTestExample = () => loadJsonExample('placeholder-test');
export const comprehensiveExample = () => loadJsonExample('comprehensive');

/**
 * Print usage information
 */
export function printExampleUsage(): void {
  const available = getAvailableJsonExamples();

  console.log('📋 Available JSON Examples:');
  console.log('===========================');

  available.forEach((name) => {
    const description =
      EXAMPLE_DESCRIPTIONS[name] || 'No description available';
    console.log(`\n📄 ${name}:`);
    console.log(`   ${description}`);
    console.log(`   Usage: loadJsonExample('${name}')`);
  });

  console.log('\n🔧 Example code:');
  console.log('```typescript');
  console.log(
    'import { loadJsonExample, generateDocumentFromJson } from "cool-report-generator";'
  );
  console.log('');
  console.log('const jsonConfig = loadJsonExample("comprehensive");');
  console.log('const document = await generateDocumentFromJson(jsonConfig);');
  console.log('```');
}
