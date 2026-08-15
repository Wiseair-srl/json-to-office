import { Command } from 'commander';
import {
  type FormatAdapter,
  loadConfig,
  formatError,
  renderLines,
  runTask,
  EXIT_CODES,
} from '@json-to-office/jto-cli';

interface DevOptions {
  port?: string;
  host?: string;
  open?: boolean;
  config?: string;
}

interface StoppableServer {
  stop(): Promise<void>;
}

function installShutdownHandlers(server: StoppableServer): void {
  let shutdownPromise: Promise<void> | undefined;

  const removeHandlers = () => {
    process.off('SIGINT', handleShutdown);
    process.off('SIGTERM', handleShutdown);
  };
  const handleShutdown = () => {
    shutdownPromise ??= (async () => {
      let exitCode: number = EXIT_CODES.OK;
      try {
        await runTask('Shutting down...', () => server.stop(), {
          success: 'Server stopped',
          failure: 'Failed to stop server',
        });
      } catch (error) {
        exitCode = EXIT_CODES.FAIL;
        await formatError(error);
      } finally {
        removeHandlers();
      }
      process.exit(exitCode);
    })();
  };

  process.once('SIGINT', handleShutdown);
  process.once('SIGTERM', handleShutdown);
}

async function openBrowser(url: string): Promise<void> {
  const { execFile } = await import('node:child_process');
  const [command, args] =
    process.platform === 'darwin'
      ? ['open', [url]]
      : process.platform === 'win32'
        ? ['cmd', ['/c', 'start', '', url]]
        : ['xdg-open', [url]];

  await new Promise<void>((resolve, reject) => {
    execFile(command, args, (error) => (error ? reject(error) : resolve()));
  });
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
        const { server, url } = await runTask(
          `Starting ${adapter.name.toUpperCase()} dev server...`,
          async () => {
            // The adapter default goes in as the loader's fallback so an
            // explicit port equal to it stays explicit — no sentinel value.
            const config = await loadConfig(options.config, {
              defaultPort: adapter.defaultPort,
            });

            // CLI flag > config file > PORT > adapter default
            const portSource = dev.getOptionValueSource('port');
            const hostSource = dev.getOptionValueSource('host');
            if (portSource === 'cli') {
              config.server.port = parseInt(options.port!, 10);
            }
            if (hostSource === 'cli') {
              config.server.host = options.host!;
            }

            const { UnifiedServer } = await import(
              '../server/unified-server.js'
            );
            const server = new UnifiedServer(adapter, config);
            await server.start();

            return {
              server,
              url: `http://${config.server.host}:${config.server.port}`,
            };
          },
          { success: 'Server ready', failure: 'Failed to start dev server' }
        );

        installShutdownHandlers(server);
        await renderLines([
          {
            text: `${adapter.name.toUpperCase()} Dev Server`,
            tone: 'success',
          },
          { text: `Local:   ${url}` },
          { text: `API:     ${url}/api/${adapter.name}/generate` },
          { text: `Health:  ${url}/health` },
          { text: 'Press Ctrl+C to stop', tone: 'muted' },
        ]);

        // Open browser if requested
        if (options.open) {
          try {
            await openBrowser(url);
          } catch (error) {
            await renderLines([
              {
                text: `Could not open browser: ${
                  error instanceof Error ? error.message : String(error)
                }`,
                tone: 'warning',
              },
            ]);
          }
        }
      } catch (error) {
        await formatError(error);
        process.exit(EXIT_CODES.FAIL);
      }
    });
}
