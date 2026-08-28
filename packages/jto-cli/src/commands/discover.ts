import { Command } from 'commander';
import chalk from 'chalk';
import {
  PluginDiscoveryService,
  type DocumentMetadata,
  type ThemeMetadata,
} from '../services/plugin-discovery.js';
import { PluginDisplay } from '../services/plugin-display.js';
import { PluginRegistry } from '../services/plugin-registry.js';
import type { FormatAdapter } from '@json-to-office/jto-ops';
import {
  createTable,
  dimPath,
  formatError,
  renderLines,
  runTask,
  writeJson,
  EXIT_CODES,
  type UiLine,
} from './ui.js';
import { exitAfterFlush } from './exit.js';

interface DiscoveryResult {
  plugins: any[];
  documents: DocumentMetadata[];
  themes: ThemeMetadata[];
}

export function createDiscoverCommand(adapter: FormatAdapter): Command {
  return new Command('discover')
    .description(
      `Discover json-to-${adapter.name} plugins, documents, and themes`
    )
    .option('-j, --json', 'Output as JSON')
    .option('-s, --schema', 'Include full schemas in output (plugins only)')
    .option('-e, --examples', 'Include usage examples (plugins only)')
    .option('-t, --type <type>', 'Type: plugin, document, theme, or all', 'all')
    .option('--scope <path>', 'Limit discovery scope to a specific directory')
    .option('--max-depth <depth>', 'Maximum search depth', '10')
    .option('--include-node-modules', 'Include node_modules in search')
    .option('-v, --verbose', 'Verbose output for debugging')
    .option('--grouped', 'Group items by location')
    .action(async (options) => {
      const discoverType = options.type?.toLowerCase() || 'all';
      const validTypes = ['plugin', 'document', 'theme', 'all'];

      try {
        if (!validTypes.includes(discoverType)) {
          throw new Error(
            `Invalid type: ${discoverType}. Must be one of: ${validTypes.join(', ')}`
          );
        }

        const scope = options.scope
          ? `scope: ${options.scope}`
          : 'entire project';
        const initial =
          discoverType === 'all'
            ? `Discovering plugins, documents, and themes in ${scope}...`
            : `Discovering ${discoverType}s in ${scope}...`;

        const discover = async (): Promise<DiscoveryResult> => {
          const service = new PluginDiscoveryService({
            scope: options.scope,
            maxDepth: parseInt(options.maxDepth, 10),
            includeNodeModules: options.includeNodeModules,
            verbose: options.verbose,
          });
          const format = adapter.name as 'docx' | 'pptx';
          if (discoverType === 'all') return service.discoverAll(format);
          if (discoverType === 'plugin') {
            return {
              plugins: await service.discoverPlugins(format),
              documents: [],
              themes: [],
            };
          }
          if (discoverType === 'document') {
            return {
              plugins: [],
              documents: await service.discoverDocuments(format),
              themes: [],
            };
          }
          return {
            plugins: [],
            documents: [],
            themes: await service.discoverThemes(format),
          };
        };

        const result = options.json
          ? await discover()
          : await runTask(initial, async () => discover(), {
              success: ({ plugins, documents, themes }) => {
                const count = plugins.length + documents.length + themes.length;
                if (count === 0) return 'No items found';
                if (discoverType !== 'all') {
                  return `Found ${count} ${discoverType}${count === 1 ? '' : 's'}`;
                }
                return `Found ${plugins.length} plugins, ${documents.length} documents, ${themes.length} themes`;
              },
              failure: 'Discovery failed',
            });

        const { plugins, documents, themes } = result;
        if (options.json) {
          if (discoverType === 'all') writeJson(result);
          else if (discoverType === 'plugin') {
            await new PluginDisplay({
              json: true,
              schema: options.schema,
              examples: options.examples,
              verbose: options.verbose,
            }).show(plugins);
          } else writeJson(discoverType === 'document' ? documents : themes);
          return;
        }

        if (discoverType === 'plugin') {
          const display = new PluginDisplay({
            schema: options.schema,
            examples: options.examples,
            verbose: options.verbose,
          });
          if (options.grouped) await display.displayGrouped(plugins);
          else await display.show(plugins);
        } else {
          const lines: UiLine[] = [];
          if (discoverType === 'all' || discoverType === 'plugin') {
            lines.push(
              ...tableLines('Plugins', plugins, 'plugin', options.grouped)
            );
          }
          if (discoverType === 'all' || discoverType === 'document') {
            lines.push(
              ...tableLines('Documents', documents, 'document', options.grouped)
            );
          }
          if (discoverType === 'all' || discoverType === 'theme') {
            lines.push(
              ...tableLines('Themes', themes, 'theme', options.grouped)
            );
          }
          await renderLines(lines);
        }
      } catch (error: any) {
        await formatError(error);
        await exitAfterFlush(EXIT_CODES.FAIL);
      } finally {
        PluginRegistry.getInstance().clear();
      }
    })
    .addHelpText(
      'after',
      `
${chalk.gray('Examples:')}
  $ jto ${adapter.name} discover
  $ jto ${adapter.name} discover --type plugin
  $ jto ${adapter.name} discover --json
  $ jto ${adapter.name} discover --grouped
`
    );
}

function tableLines(
  heading: string,
  items: any[],
  type: string,
  grouped: boolean
): UiLine[] {
  if (items.length === 0) return [];
  const lines: UiLine[] = [{ text: heading, tone: 'info' }];
  if (!grouped) {
    const rows = items.map((item) => [
      item.name || item.title || '',
      type,
      dimPath(item.filePath || item.path || ''),
    ]);
    return [...lines, { text: createTable(['Name', 'Type', 'Path'], rows) }];
  }
  for (const [location, groupItems] of Object.entries(groupByLocation(items))) {
    lines.push({ text: location, tone: 'muted' });
    const rows = groupItems.map((item: any) => [
      item.name || item.title || '',
      type,
      dimPath(item.filePath || item.path || ''),
    ]);
    lines.push({ text: createTable(['Name', 'Type', 'Path'], rows) });
  }
  return lines;
}

function groupByLocation<T extends { location: string }>(
  items: T[]
): Record<string, T[]> {
  return items.reduce<Record<string, T[]>>((groups, item) => {
    (groups[item.location] ??= []).push(item);
    return groups;
  }, {});
}
