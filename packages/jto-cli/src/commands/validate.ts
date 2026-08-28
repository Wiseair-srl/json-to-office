import { Command } from 'commander';
import chalk from 'chalk';
import { existsSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import type { FormatAdapter } from '@json-to-office/jto-ops';
import { JsonValidator } from '../services/json-validator.js';
import {
  createTable,
  formatTiming,
  formatError,
  renderLines,
  runTask,
  writeJson,
  EXIT_CODES,
} from './ui.js';
import {
  loadQualityOptions,
  parseQualityGate,
  type QualityCommandOptions,
} from './quality-options.js';
import { exitAfterFlush } from './exit.js';

interface ValidateCommandOptions extends QualityCommandOptions {
  type?: 'document' | 'theme' | 'auto';
  schema?: string;
  strict?: boolean;
  quiet?: boolean;
  format?: 'pretty' | 'json';
  recursive?: boolean;
}

export function createValidateCommand(adapter: FormatAdapter): Command {
  return new Command('validate')
    .description(`Validate JSON ${adapter.label}s or themes against schemas`)
    .argument(
      '<file-or-directory>',
      'JSON file, directory, or glob pattern to validate'
    )
    .option(
      '-t, --type <type>',
      "Validation type: 'document', 'theme', or 'auto'",
      'auto'
    )
    .option('-s, --schema <path>', 'Path to custom JSON schema file')
    .option('--strict', 'Use strict validation (no cleaning or defaults)')
    .option('-q, --quiet', 'Only output errors, no success messages')
    .option(
      '-f, --format <format>',
      "Error output format: 'pretty' or 'json'",
      'pretty'
    )
    .option(
      '-r, --recursive',
      'Validate all JSON files in directory recursively'
    )
    .option('--quality-profile <path>', 'JSON design profile')
    .option('--quality-policy <path>', 'JSON run policy')
    .option(
      '--quality-gate <severity>',
      'Gate: none, error, warning, or info',
      parseQualityGate
    )
    .action(
      async (fileOrDirectory: string, options: ValidateCommandOptions) => {
        const validator = new JsonValidator(adapter.name, adapter);
        const isJsonFormat = options.format === 'json';
        const startTime = performance.now();

        try {
          const validate = async () => {
            if (options.schema && !existsSync(resolve(options.schema))) {
              throw new Error(`Schema file not found: ${options.schema}`);
            }
            return validator.validate(fileOrDirectory, {
              type: options.type,
              schema: options.schema,
              strict: options.strict,
              recursive: options.recursive,
              quality: loadQualityOptions(options),
            });
          };

          const results =
            isJsonFormat || options.quiet
              ? await validate()
              : await runTask('Validating...', async () => validate(), {
                  success: (values) => {
                    const invalid = values.filter(
                      (result) => !result.valid
                    ).length;
                    return invalid > 0
                      ? `Validation completed: ${invalid}/${values.length} file(s) failed ${formatTiming(startTime)}`
                      : values.length === 0
                        ? 'No JSON files found to validate'
                        : `All ${values.length} file(s) are valid ${formatTiming(startTime)}`;
                  },
                  failure: 'Validation failed',
                });

          const invalidFiles = results.filter((result) => !result.valid).length;

          if (isJsonFormat) {
            process.stdout.write(`${validator.formatResultsAsJson(results)}\n`);
          } else {
            const lines = [];
            for (const result of results) {
              if (options.quiet && result.valid) continue;
              if (result.valid && (result.warnings?.length ?? 0) === 0)
                continue;
              lines.push({
                text: `${result.valid ? 'WARN' : 'FAIL'} ${relative(process.cwd(), result.file)}`,
                tone: result.valid ? ('warning' as const) : ('error' as const),
              });
              for (const error of result.errors ?? []) {
                lines.push({
                  text: validator.formatError(error, 2),
                  tone: 'error' as const,
                });
              }
              if (!options.quiet) {
                for (const warning of result.warnings ?? []) {
                  lines.push({
                    text: validator.formatError(warning, 2),
                    tone:
                      warning.severity === 'info'
                        ? ('info' as const)
                        : ('warning' as const),
                  });
                }
              }
            }

            if (results.length > 1 && !options.quiet) {
              const rows = results.map((result) => [
                relative(process.cwd(), result.file),
                !result.valid
                  ? chalk.red('FAIL')
                  : (result.warnings?.length ?? 0) > 0
                    ? chalk.yellow('WARN')
                    : chalk.green('OK'),
                result.valid
                  ? String(result.warnings?.length || 0)
                  : chalk.red(String(result.errors?.length || 0)),
              ]);
              lines.push({
                text: createTable(['File', 'Status', 'Diagnostics'], rows),
              });
            }
            await renderLines(lines);
          }

          await exitAfterFlush(
            invalidFiles > 0 ? EXIT_CODES.FAIL : EXIT_CODES.OK
          );
        } catch (error: any) {
          if (isJsonFormat) {
            writeJson({ error: true, message: error.message });
          } else {
            await formatError(error);
          }
          await exitAfterFlush(EXIT_CODES.FAIL);
        }
      }
    )
    .addHelpText(
      'after',
      `
${chalk.gray('Examples:')}
  $ jto ${adapter.name} validate document.json
  $ jto ${adapter.name} validate theme.json --type theme
  $ jto ${adapter.name} validate ./documents --recursive
  $ jto ${adapter.name} validate document.json --format json
  $ jto ${adapter.name} validate document.json --quality-gate warning
`
    );
}
