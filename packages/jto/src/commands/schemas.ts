import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import * as path from 'path';
import type { FormatAdapter } from '../format-adapter.js';
import { PluginRegistry } from '../services/plugin-registry.js';
import { PluginConfigService } from '../config/plugin-config.js';
import { SchemaGenerator } from '../services/schema-generator.js';
import { loadPlugins } from './shared.js';

interface JsonSchemaOptions {
  outputDir?: string;
  plugins?: string | boolean;
  pluginDir?: string;
  format?: 'json' | 'typebox';
  themeOnly?: boolean;
  documentOnly?: boolean;
  split?: boolean;
}

export function createSchemasCommand(adapter: FormatAdapter): Command {
  return new Command('schemas')
    .description(`Generate JSON schemas for ${adapter.label}s and themes`)
    .option(
      '-o, --output-dir <path>',
      'Output directory for schema files',
      './schemas'
    )
    .option(
      '--plugins [names-or-paths]',
      'Load plugins (comma-separated names/paths, or no value for auto-discovery)'
    )
    .option('--plugin-dir <dir>', 'Directory to search for plugins')
    .option('-f, --format <type>', 'Output format (json or typebox)', 'json')
    .option('--theme-only', 'Generate only theme schemas')
    .option('--document-only', 'Generate only document schemas')
    .option(
      '--split',
      'Generate separate schema files for each component type'
    )
    .action(async (options: JsonSchemaOptions) => {
      const spinner = ora('Initializing...').start();

      try {
        const configService = PluginConfigService.getInstance();
        const config = await configService.loadConfig();

        if (!options.themeOnly) {
          await loadPlugins(options, config, configService, spinner);
        }

        spinner.text = 'Generating schemas...';
        const generator = new SchemaGenerator(adapter.name);

        const generateOptions = {
          includeDocument: !options.themeOnly,
          includeTheme: !options.documentOnly,
          split: options.split || false,
          format: options.format || 'json',
        };

        const outputDir = path.resolve(
          process.cwd(),
          options.outputDir || './schemas'
        );
        const results = await generator.generateAndExportSchemas(
          outputDir,
          generateOptions
        );

        spinner.succeed('Schema generation completed!');

        console.log(`\n${chalk.bold('Generated Schemas:')}\n`);

        if (results.document) {
          console.log(chalk.cyan('  Document Schema:'));
          console.log(chalk.dim(`    ${results.document}`));
        }

        if (results.theme) {
          console.log(chalk.cyan('  Theme Schema:'));
          console.log(chalk.dim(`    ${results.theme}`));
        }

        if (results.components && results.components.length > 0) {
          console.log(chalk.cyan('  Component Schemas:'));
          results.components.forEach((componentPath) => {
            console.log(chalk.dim(`    ${componentPath}`));
          });
        }

        const registry = PluginRegistry.getInstance();
        const loadedPlugins = registry.getPlugins();
        if (loadedPlugins.length > 0) {
          console.log(chalk.cyan('\n  Included Plugins:'));
          loadedPlugins.forEach((plugin) => {
            console.log(
              chalk.dim(
                `    - ${plugin.name}${(plugin as any).version ? ` (${(plugin as any).version})` : ''}`
              )
            );
          });
        }

        console.log('\n' + chalk.green('Schemas are ready for use!'));

        PluginRegistry.cleanup();
        process.exit(0);
      } catch (error: any) {
        spinner.fail('Schema generation failed');
        console.error(chalk.red('\nError:'), error.message);
        PluginRegistry.cleanup();
        process.exit(1);
      }
    })
    .addHelpText(
      'after',
      `
${chalk.gray('Examples:')}
  $ jto ${adapter.name} schemas                           ${chalk.dim('# Generate schemas without plugins')}
  $ jto ${adapter.name} schemas --plugins                 ${chalk.dim('# Auto-discover and include plugins')}
  $ jto ${adapter.name} schemas --format typebox          ${chalk.dim('# Generate TypeBox TypeScript files')}
  $ jto ${adapter.name} schemas --theme-only              ${chalk.dim('# Generate only theme schemas')}
  $ jto ${adapter.name} schemas --split                   ${chalk.dim('# Generate individual component schemas')}
`
    );
}
