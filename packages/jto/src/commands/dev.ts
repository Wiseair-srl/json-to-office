import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import boxen from 'boxen';
import {
  type FormatAdapter,
  loadConfig,
  formatError,
  EXIT_CODES,
} from '@json-to-office/jto-cli';

interface DevOptions {
  port?: string;
  host?: string;
  open?: boolean;
  config?: string;
}

export function createDevCommand(adapter: FormatAdapter): Command {
  const dev = new Command('dev');
  return dev
    .description('Start development server with web UI')
    .option(
      '-p, --port <port>',
      'Port to run server on',
      String(adapter.defaultPort)
    )
    .option('-H, --host <host>', 'Host to bind to', 'localhost')
    .option('-o, --open', 'Open browser automatically')
    .option('-c, --config <path>', 'Path to config file')
    .action(async (options: DevOptions) => {
      const spinner = ora(
        `Starting ${adapter.name.toUpperCase()} dev server...`
      ).start();

      try {
        const config = await loadConfig(options.config);

        // CLI flag > adapter default > config file default
        const portSource = dev.getOptionValueSource('port');
        const hostSource = dev.getOptionValueSource('host');
        if (portSource === 'cli') {
          config.server.port = parseInt(options.port!, 10);
        } else if (
          config.server.port === 3003 &&
          adapter.defaultPort !== 3003
        ) {
          config.server.port = adapter.defaultPort;
        }
        if (hostSource === 'cli') {
          config.server.host = options.host!;
        }

        const { UnifiedServer } = await import('../server/unified-server.js');
        const server = new UnifiedServer(adapter, config);
        await server.start();

        const url = `http://${config.server.host}:${config.server.port}`;
        spinner.succeed('Server ready');

        console.log(
          boxen(
            chalk.bold(`${adapter.name.toUpperCase()} Dev Server\n\n`) +
              `${chalk.cyan('Local:')}   ${chalk.bold(url)}\n` +
              `${chalk.cyan('API:')}     ${url}/api/${adapter.name}/generate\n` +
              `${chalk.cyan('Health:')}  ${url}/health\n\n` +
              chalk.gray('Press Ctrl+C to stop'),
            {
              padding: 1,
              borderColor: 'green',
              borderStyle: 'round',
            }
          )
        );

        // Open browser if requested
        if (options.open) {
          const { execFile } = await import('child_process');
          const cmd =
            process.platform === 'darwin'
              ? 'open'
              : process.platform === 'win32'
                ? 'start'
                : 'xdg-open';
          execFile(cmd, [url]);
        }

        // Graceful shutdown
        const shutdown = async () => {
          console.log(chalk.yellow('\nShutting down...'));
          await server.stop();
          process.exit(EXIT_CODES.OK);
        };

        process.on('SIGINT', shutdown);
        process.on('SIGTERM', shutdown);
      } catch (error: any) {
        spinner.fail('Failed to start dev server');
        formatError(error);
        process.exit(EXIT_CODES.FAIL);
      }
    });
}
