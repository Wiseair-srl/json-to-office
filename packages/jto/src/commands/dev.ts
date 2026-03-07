import { Command } from 'commander';
import chalk from 'chalk';
import type { FormatAdapter } from '../format-adapter.js';

interface DevOptions {
  port?: string;
  host?: string;
  open?: boolean;
  config?: string;
}

export function createDevCommand(adapter: FormatAdapter): Command {
  return new Command('dev')
    .description('Start development server with web UI')
    .option(
      '-p, --port <port>',
      'Port to run server on',
      String(adapter.defaultPort)
    )
    .option('-h, --host <host>', 'Host to bind to', 'localhost')
    .option('-o, --open', 'Open browser automatically')
    .option('-c, --config <path>', 'Path to config file')
    .action(async (options: DevOptions) => {
      console.log(
        chalk.blue(
          `Starting ${adapter.name.toUpperCase()} dev server on port ${options.port}...`
        )
      );
      console.log(chalk.gray('(not yet implemented — Phase 3)'));
    });
}
