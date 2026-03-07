/**
 * Universal example runner utility
 * Provides common functionality for running examples
 */

import { generateDocument, saveDocument } from '../core/generator';
import { ReportComponentDefinition } from '../types';
import * as path from 'path';
import * as fs from 'fs';

export interface ExampleRunnerOptions {
  outputFilename?: string;
  outputDir?: string;
  verbose?: boolean;
}

/**
 * Run an example and generate a document
 * @param example - The example definition to run
 * @param options - Options for running the example
 */
export async function runExample(
  example: ReportComponentDefinition,
  options: ExampleRunnerOptions = {}
): Promise<void> {
  const { outputFilename, outputDir, verbose = true } = options;

  if (!example.props) {
    throw new Error('Example must have props');
  }

  const reportTitle = String(example.props.metadata?.title) || 'Document';
  const baseFilename =
    outputFilename || `${reportTitle.toLowerCase().replace(/\s+/g, '-')}.docx`;

  // Use output directory if provided, otherwise use default output/examples path
  const defaultOutputDir = path.join(process.cwd(), 'output', 'examples');
  const finalOutputDir = outputDir || defaultOutputDir;
  const filename = path.join(finalOutputDir, baseFilename);

  if (verbose) {
    console.log(`=== ${reportTitle} Generation ===\n`);
    console.log(`Generating ${reportTitle} with modular system...`);
  }

  try {
    // Ensure output directory exists
    await fs.promises.mkdir(finalOutputDir, { recursive: true });

    const document = await generateDocument(example);
    await saveDocument(document, filename);

    if (verbose) {
      console.log(`✓ ${reportTitle} saved: ${filename}`);
      console.log(`\n✅ ${reportTitle} generated successfully!`);
    }
  } catch (error) {
    if (verbose) {
      console.error(`${reportTitle} generation failed:`, error);
    }
    throw error;
  }
}
