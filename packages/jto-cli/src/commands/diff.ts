import { Command } from 'commander';
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import chalk from 'chalk';
import type { FormatAdapter } from '@json-to-office/jto-ops';
import {
  shortPath,
  formatTiming,
  formatError,
  renderLines,
  runTask,
  writeJson,
  EXIT_CODES,
} from './ui.js';

interface DiffOptions {
  output?: string;
  author?: string;
  date?: string;
  jsonOut?: string;
  format?: 'pretty' | 'json';
  dryRun?: boolean;
}

function readDefinition(label: string, filePath: string): unknown {
  let content: string;
  try {
    content = readFileSync(filePath, 'utf-8');
  } catch {
    throw new Error(`Cannot read ${label} document: ${filePath}`);
  }
  try {
    return JSON.parse(content);
  } catch (error: any) {
    throw new Error(
      `${label} document is not valid JSON (${filePath}): ${error.message}`
    );
  }
}

async function validateDefinition(
  label: string,
  filePath: string,
  definition: unknown
): Promise<void> {
  const sharedDocx = await import('@json-to-office/shared-docx');
  const result = sharedDocx.validate.jsonDocument(JSON.stringify(definition));
  if (!result.valid) {
    const details = (result.errors || [])
      .slice(0, 5)
      .map((e: any) => `  - ${e.path || ''} ${e.message || e}`)
      .join('\n');
    throw new Error(
      `${label} document failed validation (${filePath}):\n${details}`
    );
  }
}

export function createDiffCommand(adapter: FormatAdapter): Command {
  return new Command('diff')
    .description(
      'Diff two JSON documents into a redline .docx with native Word tracked changes'
    )
    .argument('<old>', 'Old (base) JSON document')
    .argument('<new>', 'New (revised) JSON document')
    .option('-o, --output <path>', 'Output redline file path', 'redline.docx')
    .option(
      '--author <name>',
      'Revision author shown in Word',
      'json-to-office'
    )
    .option('--date <iso>', 'Revision timestamp (ISO 8601, default: now)')
    .option(
      '--json-out <path>',
      'Also write the redline JSON definition to this path'
    )
    .option(
      '-f, --format <format>',
      "Summary output format: 'pretty' or 'json'",
      'pretty'
    )
    .option('--dry-run', 'Compute the diff and summary without writing files')
    .action(
      async (oldInput: string, newInput: string, options: DiffOptions) => {
        const isJsonFormat = options.format === 'json';
        const startTime = performance.now();

        try {
          const execute = async (update: (message: string) => void) => {
            if (adapter.name !== 'docx') {
              throw new Error(
                'diff is only supported for DOCX documents (PPTX visual diff is not available yet)'
              );
            }

            const oldPath = resolve(process.cwd(), oldInput);
            const newPath = resolve(process.cwd(), newInput);
            const oldDoc = readDefinition('Old', oldPath);
            const newDoc = readDefinition('New', newPath);

            update('Validating inputs...');
            await validateDefinition('Old', oldPath, oldDoc);
            await validateDefinition('New', newPath, newDoc);

            const revisionDate = options.date
              ? new Date(options.date)
              : new Date();
            if (isNaN(revisionDate.getTime())) {
              throw new Error(
                `Invalid --date: "${options.date}" (expected ISO 8601, e.g. 2026-06-09T10:00:00Z)`
              );
            }

            update('Computing diff...');
            const { diffDocuments } = await import(
              '@json-to-office/shared-docx'
            );
            type JsonNode = import('@json-to-office/shared-docx').JsonNode;
            const { document, summary } = diffDocuments(
              oldDoc as JsonNode,
              newDoc as JsonNode,
              { author: options.author, date: revisionDate.toISOString() }
            );

            const outputPath = resolve(
              process.cwd(),
              options.output || 'redline.docx'
            );
            const jsonOutPath = options.jsonOut
              ? resolve(process.cwd(), options.jsonOut)
              : undefined;

            if (!options.dryRun) {
              if (jsonOutPath)
                writeFileSync(jsonOutPath, JSON.stringify(document, null, 2));
              update('Rendering redline document...');
              const buffer = await adapter.generateBuffer(document, {});
              writeFileSync(outputPath, buffer);
            }
            return { summary, outputPath, jsonOutPath };
          };

          const result = isJsonFormat
            ? await execute(() => undefined)
            : await runTask(
                'Diffing documents...',
                async (reporter) => execute(reporter.update),
                {
                  success: () =>
                    `${options.dryRun ? 'Diff computed (dry run)' : 'Redline written'} ${formatTiming(startTime)}`,
                  failure: 'Diff failed',
                }
              );
          const { summary, outputPath, jsonOutPath } = result;
          const totalTracked =
            summary.tracked.modified +
            summary.tracked.inserted +
            summary.tracked.deleted;

          if (isJsonFormat) {
            writeJson({
              output: options.dryRun ? null : outputPath,
              jsonOut: options.dryRun ? null : jsonOutPath ?? null,
              summary,
            });
          } else {
            const lines = [
              {
                text:
                  `Tracked changes: ${chalk.green(`${summary.tracked.inserted} inserted`)}, ` +
                  `${chalk.red(`${summary.tracked.deleted} deleted`)}, ` +
                  `${chalk.yellow(`${summary.tracked.modified} modified`)} ` +
                  chalk.dim(`(${summary.unchangedBlocks} blocks unchanged)`),
              },
            ];
            if (totalTracked === 0 && summary.untracked.length === 0) {
              lines.push({ text: 'Documents are identical.' });
            }
            if (summary.untracked.length > 0) {
              lines.push({
                text: `${summary.untracked.length} change(s) not expressible as tracked changes:`,
              });
              for (const change of summary.untracked) {
                lines.push({
                  text: `! ${change.path} [${change.component}] ${change.detail}`,
                });
              }
            }
            if (summary.notes.length > 0) {
              for (const note of summary.notes) {
                lines.push({ text: `Note: ${note}` });
              }
            }
            if (jsonOutPath && !options.dryRun) {
              lines.push({ text: `Redline JSON: ${shortPath(jsonOutPath)}` });
            }
            if (!options.dryRun) {
              lines.unshift({ text: `Output: ${shortPath(outputPath)}` });
            }
            await renderLines(lines);
          }
        } catch (error: any) {
          if (isJsonFormat) {
            writeJson({ error: true, message: error.message });
          } else {
            await formatError(error);
          }
          process.exit(EXIT_CODES.FAIL);
        }
        process.exit(EXIT_CODES.OK);
      }
    )
    .addHelpText(
      'after',
      `
${chalk.gray('Examples:')}
  $ jto docx diff contract-v1.json contract-v2.json -o redline.docx
  $ jto docx diff old.json new.json --author "jto-agent"
  $ jto docx diff old.json new.json --json-out redline.json --format json
  $ jto docx diff old.json new.json --dry-run                ${chalk.dim('# summary only')}
`
    );
}
