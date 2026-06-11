import { Command } from 'commander';
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import ora from 'ora';
import chalk from 'chalk';
import type { FormatAdapter } from '../format-adapter.js';
import { shortPath, formatTiming, formatError, EXIT_CODES } from './ui.js';

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
        const spinner = isJsonFormat
          ? null
          : ora('Diffing documents...').start();
        const startTime = performance.now();

        try {
          if (adapter.name !== 'docx') {
            throw new Error(
              'diff is only supported for DOCX documents (PPTX visual diff is not available yet)'
            );
          }

          const oldPath = resolve(process.cwd(), oldInput);
          const newPath = resolve(process.cwd(), newInput);
          const oldDoc = readDefinition('Old', oldPath);
          const newDoc = readDefinition('New', newPath);

          if (spinner) spinner.text = 'Validating inputs...';
          await validateDefinition('Old', oldPath, oldDoc);
          await validateDefinition('New', newPath, newDoc);

          // Validate and canonicalize --date: an invalid value would produce
          // revision dates that fail both RevisionSchema and OOXML ST_DateTime
          const revisionDate = options.date
            ? new Date(options.date)
            : new Date();
          if (isNaN(revisionDate.getTime())) {
            throw new Error(
              `Invalid --date: "${options.date}" (expected ISO 8601, e.g. 2026-06-09T10:00:00Z)`
            );
          }

          if (spinner) spinner.text = 'Computing diff...';
          const { diffDocuments } = await import('@json-to-office/shared-docx');
          type JsonNode = import('@json-to-office/shared-docx').JsonNode;
          const { document, summary } = diffDocuments(
            oldDoc as JsonNode,
            newDoc as JsonNode,
            {
              author: options.author,
              date: revisionDate.toISOString(),
            }
          );

          const outputPath = resolve(
            process.cwd(),
            options.output || 'redline.docx'
          );
          const jsonOutPath = options.jsonOut
            ? resolve(process.cwd(), options.jsonOut)
            : undefined;

          if (!options.dryRun) {
            if (jsonOutPath) {
              writeFileSync(jsonOutPath, JSON.stringify(document, null, 2));
            }
            if (spinner) spinner.text = 'Rendering redline document...';
            const buffer = await adapter.generateBuffer(document, {});
            writeFileSync(outputPath, buffer);
          }

          const totalTracked =
            summary.tracked.modified +
            summary.tracked.inserted +
            summary.tracked.deleted;

          if (isJsonFormat) {
            console.log(
              JSON.stringify(
                {
                  output: options.dryRun ? null : outputPath,
                  jsonOut: options.dryRun ? null : jsonOutPath ?? null,
                  summary,
                },
                null,
                2
              )
            );
          } else if (spinner) {
            if (options.dryRun) {
              spinner.succeed(
                `Diff computed (dry run) ${formatTiming(startTime)}`
              );
            } else {
              spinner.succeed(
                `Redline written to ${shortPath(outputPath)} ${formatTiming(startTime)}`
              );
            }
            console.log('');
            console.log(
              `  Tracked changes: ${chalk.green(`${summary.tracked.inserted} inserted`)}, ` +
                `${chalk.red(`${summary.tracked.deleted} deleted`)}, ` +
                `${chalk.yellow(`${summary.tracked.modified} modified`)} ` +
                chalk.dim(`(${summary.unchangedBlocks} blocks unchanged)`)
            );
            if (totalTracked === 0 && summary.untracked.length === 0) {
              console.log(chalk.dim('  Documents are identical.'));
            }
            if (summary.untracked.length > 0) {
              console.log('');
              console.log(
                chalk.yellow(
                  `  ${summary.untracked.length} change(s) not expressible as tracked changes:`
                )
              );
              for (const change of summary.untracked) {
                console.log(
                  chalk.yellow(`  ! ${change.path}`) +
                    chalk.dim(` [${change.component}] ${change.detail}`)
                );
              }
            }
            if (summary.notes.length > 0) {
              console.log('');
              for (const note of summary.notes) {
                console.log(chalk.dim(`  Note: ${note}`));
              }
            }
            if (jsonOutPath && !options.dryRun) {
              console.log('');
              console.log(
                chalk.dim(`  Redline JSON: ${shortPath(jsonOutPath)}`)
              );
            }
          }
        } catch (error: any) {
          if (spinner) spinner.fail('Diff failed');
          if (isJsonFormat) {
            console.log(
              JSON.stringify({ error: true, message: error.message }, null, 2)
            );
          } else {
            formatError(error);
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
