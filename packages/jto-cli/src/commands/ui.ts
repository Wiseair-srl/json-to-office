import { relative, dirname, basename } from 'path';
import chalk from 'chalk';
import Table from 'cli-table3';

export const EXIT_CODES = { OK: 0, FAIL: 1 } as const;

export function shortPath(absPath: string): string {
  return relative(process.cwd(), absPath) || absPath;
}

export function dimPath(absPath: string): string {
  const rel = shortPath(absPath);
  const dir = dirname(rel);
  const file = basename(rel);
  return dir === '.'
    ? chalk.bold(file)
    : chalk.dim(dir + '/') + chalk.bold(file);
}

export function createTable(headers: string[], rows: string[][]): string {
  const table = new Table({
    head: headers.map((h) => chalk.bold(h)),
    style: { head: [], border: ['gray'] },
    wordWrap: true,
  });
  for (const row of rows) table.push(row);
  return table.toString();
}

export function formatTiming(startMs: number): string {
  const ms = Math.round(performance.now() - startMs);
  return chalk.dim(`(${ms}ms)`);
}

export function formatError(error: any): void {
  if (error.code === 'ENOENT') {
    console.error(chalk.red(`File not found: ${error.path || error.message}`));
  } else if (error instanceof SyntaxError) {
    console.error(chalk.red('Invalid JSON in input file'));
    console.error(chalk.dim(error.message));
  } else {
    console.error(chalk.red(error.message));
    if (error.validationErrors) {
      console.error(chalk.yellow('\nValidation errors:'));
      for (const err of error.validationErrors) {
        console.error(chalk.red(`  - ${err.path || 'root'}: ${err.message}`));
        if (err.suggestions) {
          for (const s of err.suggestions) {
            console.error(chalk.dim(`    -> ${s}`));
          }
        }
      }
    }
    if (error.stack && !error.validationErrors) {
      console.error(chalk.dim('\nStack trace:'));
      console.error(chalk.dim(error.stack));
    }
  }
}
