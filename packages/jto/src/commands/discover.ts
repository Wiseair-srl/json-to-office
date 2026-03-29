import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import {
  PluginDiscoveryService,
  type DocumentMetadata,
  type ThemeMetadata,
} from '../services/plugin-discovery.js';
import { PluginDisplay } from '../services/plugin-display.js';
import { PluginRegistry } from '../services/plugin-registry.js';
import type { FormatAdapter } from '../format-adapter.js';
import { createTable, dimPath, formatError, EXIT_CODES } from './ui.js';

export function createDiscoverCommand(adapter: FormatAdapter): Command {
  return new Command('discover')
    .description(
      `Discover json-to-${adapter.name} plugins, documents, and themes`
    )
    .option('-j, --json', 'Output as JSON')
    .option('-s, --schema', 'Include full schemas in output (plugins only)')
    .option('-e, --examples', 'Include usage examples (plugins only)')
    .option(
      '-t, --type <type>',
      'Type to discover: plugin, document, theme, or all (default: all)',
      'all'
    )
    .option(
      '-s, --scope <path>',
      'Limit discovery scope to a specific directory'
    )
    .option('--max-depth <depth>', 'Maximum search depth', '10')
    .option('--include-node-modules', 'Include node_modules in search')
    .option('-v, --verbose', 'Verbose output for debugging')
    .option('--grouped', 'Group items by location')
    .action(async (options) => {
      const discoverType = options.type?.toLowerCase() || 'all';
      const validTypes = ['plugin', 'document', 'theme', 'all'];

      if (!validTypes.includes(discoverType)) {
        console.error(
          chalk.red(
            `Invalid type: ${discoverType}. Must be one of: ${validTypes.join(', ')}`
          )
        );
        process.exit(EXIT_CODES.FAIL);
      }

      const scopeDescription = options.scope
        ? `scope: ${options.scope}`
        : 'entire project';

      const spinnerText =
        discoverType === 'all'
          ? `Discovering plugins, documents, and themes in ${scopeDescription}...`
          : `Discovering ${discoverType}s in ${scopeDescription}...`;
      const spinner = options.json ? null : ora(spinnerText).start();

      try {
        const discoveryOptions = {
          scope: options.scope,
          maxDepth: parseInt(options.maxDepth, 10),
          includeNodeModules: options.includeNodeModules,
          verbose: options.verbose,
        };

        const discovery = new PluginDiscoveryService(discoveryOptions);

        let plugins: any[] = [];
        let documents: DocumentMetadata[] = [];
        let themes: ThemeMetadata[] = [];
        let totalCount = 0;

        const format = adapter.name as 'docx' | 'pptx';

        if (discoverType === 'all') {
          const results = await discovery.discoverAll(format);
          plugins = results.plugins;
          documents = results.documents;
          themes = results.themes;
          totalCount = plugins.length + documents.length + themes.length;
        } else if (discoverType === 'plugin') {
          plugins = await discovery.discoverPlugins(format);
          totalCount = plugins.length;
        } else if (discoverType === 'document') {
          documents = await discovery.discoverDocuments(format);
          totalCount = documents.length;
        } else if (discoverType === 'theme') {
          themes = await discovery.discoverThemes(format);
          totalCount = themes.length;
        }

        if (spinner) {
          if (totalCount === 0) {
            spinner.warn(
              `No ${discoverType === 'all' ? 'items' : discoverType + 's'} found`
            );
          } else {
            const message =
              discoverType === 'all'
                ? `Found ${plugins.length} plugin${plugins.length !== 1 ? 's' : ''}, ` +
                  `${documents.length} document${documents.length !== 1 ? 's' : ''}, ` +
                  `${themes.length} theme${themes.length !== 1 ? 's' : ''}`
                : `Found ${totalCount} ${discoverType}${totalCount !== 1 ? 's' : ''}`;
            spinner.succeed(message);
          }
        }

        if (options.json) {
          if (discoverType === 'all') {
            console.log(
              JSON.stringify({ plugins, documents, themes }, null, 2)
            );
          } else if (discoverType === 'plugin') {
            const display = new PluginDisplay({
              json: true,
              schema: options.schema,
              examples: options.examples,
              verbose: options.verbose,
            });
            await display.show(plugins);
          } else if (discoverType === 'document') {
            console.log(JSON.stringify(documents, null, 2));
          } else if (discoverType === 'theme') {
            console.log(JSON.stringify(themes, null, 2));
          }
        } else {
          if (discoverType === 'all') {
            if (plugins.length > 0) {
              console.log(chalk.bold('\nPlugins:'));
              displayAsTable(plugins, 'plugin', options.grouped);
            }
            if (documents.length > 0) {
              console.log(chalk.bold('\nDocuments:'));
              displayAsTable(documents, 'document', options.grouped);
            }
            if (themes.length > 0) {
              console.log(chalk.bold('\nThemes:'));
              displayAsTable(themes, 'theme', options.grouped);
            }
          } else if (discoverType === 'plugin') {
            const display = new PluginDisplay({
              json: false,
              schema: options.schema,
              examples: options.examples,
              verbose: options.verbose,
            });
            if (options.grouped) {
              display.displayGrouped(plugins);
            } else {
              await display.show(plugins);
            }
          } else if (discoverType === 'document') {
            displayAsTable(documents, 'document', options.grouped);
          } else if (discoverType === 'theme') {
            displayAsTable(themes, 'theme', options.grouped);
          }
        }

        PluginRegistry.getInstance().clear();
      } catch (error: any) {
        if (spinner) spinner.fail('Discovery failed');
        formatError(error);
        PluginRegistry.getInstance().clear();
        process.exit(EXIT_CODES.FAIL);
      }
    })
    .addHelpText(
      'after',
      `
${chalk.gray('Examples:')}
  $ jto ${adapter.name} discover                     ${chalk.dim('# Discover all items')}
  $ jto ${adapter.name} discover --type plugin       ${chalk.dim('# Discover only plugins')}
  $ jto ${adapter.name} discover --json              ${chalk.dim('# Output as JSON')}
  $ jto ${adapter.name} discover --grouped           ${chalk.dim('# Group by location')}
`
    );
}

function displayAsTable(items: any[], type: string, grouped: boolean) {
  if (grouped) {
    const groups = groupByLocation(items);
    for (const [location, groupItems] of Object.entries(groups)) {
      if (groupItems.length > 0) {
        console.log(chalk.gray(`\n  ${location}:`));
        const rows = groupItems.map((item: any) => [
          item.name || item.title || '',
          type,
          dimPath(item.filePath || item.path || ''),
        ]);
        console.log(createTable(['Name', 'Type', 'Path'], rows));
      }
    }
  } else {
    const rows = items.map((item: any) => [
      item.name || item.title || '',
      type,
      dimPath(item.filePath || item.path || ''),
    ]);
    console.log(createTable(['Name', 'Type', 'Path'], rows));
  }
}

function groupByLocation<T extends { location: string }>(
  items: T[]
): Record<string, T[]> {
  return items.reduce(
    (acc, item) => {
      const loc = item.location;
      if (!acc[loc]) acc[loc] = [];
      acc[loc].push(item);
      return acc;
    },
    {} as Record<string, T[]>
  );
}
