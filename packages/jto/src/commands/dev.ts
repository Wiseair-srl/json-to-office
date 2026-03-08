import { Command } from 'commander';
import chalk from 'chalk';
import type { FormatAdapter } from '../format-adapter.js';
import { loadConfig } from '../config/loader.js';

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
      try {
        const config = await loadConfig(options.config);

        // CLI flag > adapter default > config file default
        const portSource = dev.getOptionValueSource('port');
        const hostSource = dev.getOptionValueSource('host');
        if (portSource === 'cli') {
          config.server.port = parseInt(options.port!, 10);
        } else if (config.server.port === 3003 && adapter.defaultPort !== 3003) {
          // Config still has the generic default — use the adapter-specific port
          config.server.port = adapter.defaultPort;
        }
        if (hostSource === 'cli') {
          config.server.host = options.host!;
        }

        console.log(
          chalk.blue(
            `\nStarting ${adapter.name.toUpperCase()} dev server...`
          )
        );

        const { UnifiedServer } = await import('../server/unified-server.js');
        const server = new UnifiedServer(adapter, config);
        await server.start();

        const url = `http://${config.server.host}:${config.server.port}`;
        console.log(chalk.green(`\n  Server running at ${chalk.bold(url)}`));
        console.log(chalk.gray(`  Format: ${adapter.name.toUpperCase()}`));
        console.log(chalk.gray(`  API: ${url}/api/${adapter.name}/generate`));
        console.log(chalk.gray(`  Health: ${url}/health`));
        console.log(chalk.gray(`\n  Press Ctrl+C to stop\n`));

        // Open browser if requested
        if (options.open) {
          const { execFile } = await import('child_process');
          const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
          execFile(cmd, [url]);
        }

        // Graceful shutdown
        const shutdown = async () => {
          console.log(chalk.yellow('\nShutting down...'));
          await server.stop();
          process.exit(0);
        };

        process.on('SIGINT', shutdown);
        process.on('SIGTERM', shutdown);
      } catch (error: any) {
        console.error(chalk.red('Failed to start dev server:'), error.message);
        if (error.stack) console.error(chalk.dim(error.stack));
        process.exit(1);
      }
    });
}
