import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { resolve, relative } from 'path';
import { existsSync } from 'fs';
import type { FormatAdapter } from '../format-adapter.js';
import { JsonValidator } from '../services/json-validator.js';
import { createTable, formatTiming, formatError, EXIT_CODES } from './ui.js';

interface ValidateCommandOptions {
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
      'Validation type: \'document\', \'theme\', or \'auto\'',
      'auto'
    )
    .option('-s, --schema <path>', 'Path to custom JSON schema file')
    .option('--strict', 'Use strict validation (no cleaning or defaults)')
    .option('-q, --quiet', 'Only output errors, no success messages')
    .option(
      '-f, --format <format>',
      'Error output format: \'pretty\' or \'json\'',
      'pretty'
    )
    .option(
      '-r, --recursive',
      'Validate all JSON files in directory recursively'
    )
    .action(
      async (fileOrDirectory: string, options: ValidateCommandOptions) => {
        const validator = new JsonValidator(adapter.name);
        const isJsonFormat = options.format === 'json';

        const showSpinner = !options.quiet && !isJsonFormat;
        const spinner = showSpinner ? ora('Validating...').start() : null;
        const startTime = performance.now();

        try {
          if (options.schema && !existsSync(resolve(options.schema))) {
            throw new Error(`Schema file not found: ${options.schema}`);
          }

          const results = await validator.validate(fileOrDirectory, {
            type: options.type,
            schema: options.schema,
            strict: options.strict,
            recursive: options.recursive,
          });

          if (results.length === 0) {
            if (spinner) spinner.warn('No JSON files found to validate');
            process.exit(EXIT_CODES.OK);
          }

          const totalFiles = results.length;
          const validFiles = results.filter((r) => r.valid).length;
          const invalidFiles = totalFiles - validFiles;

          if (isJsonFormat) {
            console.log(validator.formatResultsAsJson(results));
          } else {
            if (spinner) {
              if (invalidFiles > 0) {
                spinner.fail(
                  `Validation completed: ${invalidFiles}/${totalFiles} file(s) failed ${formatTiming(startTime)}`
                );
              } else {
                spinner.succeed(`All ${totalFiles} file(s) are valid! ${formatTiming(startTime)}`);
              }
            }

            if (!options.quiet || invalidFiles > 0) {
              console.log('');

              // Show per-file error details for failed files
              for (const result of results) {
                if (!result.valid) {
                  const relativePath = relative(process.cwd(), result.file);
                  console.log(chalk.red('FAIL'), chalk.bold(relativePath));

                  if (result.errors && result.errors.length > 0) {
                    console.log(chalk.red('  Errors:'));
                    for (const error of result.errors) {
                      console.log(
                        chalk.red(validator.formatError(error, 4))
                      );
                    }
                  }

                  if (result.warnings && result.warnings.length > 0) {
                    console.log(chalk.yellow('  Warnings:'));
                    for (const warning of result.warnings) {
                      console.log(
                        chalk.yellow(validator.formatError(warning, 4))
                      );
                    }
                  }

                  console.log('');
                }
              }
            }

            if (totalFiles > 1 && !options.quiet) {
              const rows = results.map((r) => {
                const relativePath = relative(process.cwd(), r.file);
                const status = r.valid ? chalk.green('OK') : chalk.red('FAIL');
                const errorCount = r.valid ? '-' : chalk.red(String(r.errors?.length || 0));
                return [relativePath, status, errorCount];
              });
              console.log(createTable(['File', 'Status', 'Errors'], rows));
            }
          }

          process.exit(invalidFiles > 0 ? EXIT_CODES.FAIL : EXIT_CODES.OK);
        } catch (error: any) {
          if (spinner) spinner.fail('Validation failed');

          if (isJsonFormat) {
            console.log(
              JSON.stringify({ error: true, message: error.message }, null, 2)
            );
          } else {
            formatError(error);
          }

          process.exit(EXIT_CODES.FAIL);
        }
      }
    )
    .addHelpText(
      'after',
      `
${chalk.gray('Examples:')}
  $ jto ${adapter.name} validate document.json                     ${chalk.dim('# Validate a single file')}
  $ jto ${adapter.name} validate theme.json --type theme           ${chalk.dim('# Validate with specific type')}
  $ jto ${adapter.name} validate ./documents --recursive           ${chalk.dim('# Validate all JSON files in directory')}
  $ jto ${adapter.name} validate document.json --format json       ${chalk.dim('# Output as JSON for tooling')}
`
    );
}
