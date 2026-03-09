import { Command } from 'commander';
import { readFileSync, writeFileSync } from 'fs';
import { resolve, basename } from 'path';
import ora from 'ora';
import chalk from 'chalk';
import boxen from 'boxen';
import type { FormatAdapter } from '../format-adapter.js';
import { PluginRegistry } from '../services/plugin-registry.js';

import { GeneratorFactory } from '../services/generator-factory.js';
import { PluginConfigService } from '../config/plugin-config.js';
import { loadPlugins } from './shared.js';
import { shortPath, formatTiming, formatError, EXIT_CODES } from './ui.js';

interface GenerateOptions {
  output?: string;
  template?: string;
  plugins?: string | boolean;
  pluginDir?: string;
  theme?: string;
  themePath?: string;
  strict?: boolean;
  dryRun?: boolean;
}

export function createGenerateCommand(adapter: FormatAdapter): Command {
  return new Command('generate')
    .description(`Generate ${adapter.label} from JSON`)
    .argument('<input>', 'Input JSON file path')
    .option('-o, --output <path>', 'Output file path')
    .option('-t, --template <name>', 'Template to use')
    .option(
      '--plugins [names-or-paths]',
      'Load plugins (comma-separated names/paths, or no value for auto-discovery)'
    )
    .option('--plugin-dir <dir>', 'Directory to search for plugins')
    .option('--theme <name-or-path>', 'Theme name or path to theme file')
    .option('--theme-path <path>', 'Path to theme file (alternative to --theme)')
    .option('--strict', 'Enable strict validation')
    .option('--dry-run', 'Preview without writing files')
    .action(async (input: string, options: GenerateOptions) => {
      const spinner = ora('Initializing...').start();
      const startTime = performance.now();

      try {
        const configService = PluginConfigService.getInstance();
        const config = await configService.loadConfig();

        const mergedConfig = config
          ? configService.mergeWithOptions({
            theme: options.theme,
            themePath: options.themePath,
            validation: { strict: options.strict },
          })
          : {
            theme: options.theme,
            themePath: options.themePath,
            validation: { strict: options.strict },
          };

        await loadPlugins(options, config, configService, spinner);

        spinner.text = 'Reading input file...';
        const inputPath = resolve(process.cwd(), input);
        const jsonContent = readFileSync(inputPath, 'utf-8');
        const documentDefinition = JSON.parse(jsonContent);

        const factory = new GeneratorFactory(adapter);

        const outputPath = options.output
          ? resolve(process.cwd(), options.output)
          : resolve(process.cwd(), basename(input, '.json') + adapter.extension);

        const pluginInfo = factory.getPluginInfo();

        if (options.dryRun) {
          spinner.succeed(`Dry run complete ${formatTiming(startTime)}`);

          const lines = [
            `${chalk.cyan('Input:')}      ${input}`,
            `${chalk.cyan('Output:')}     ${shortPath(outputPath)}`,
            `${chalk.cyan('Format:')}     ${adapter.name}`,
            `${chalk.cyan('Theme:')}      ${mergedConfig.theme || 'default'}`,
            `${chalk.cyan('Strict:')}     ${mergedConfig.validation?.strict ? 'yes' : 'no'}`,
          ];
          if (pluginInfo.hasPlugins) {
            lines.push(`${chalk.cyan('Plugins:')}    ${pluginInfo.count} loaded (${pluginInfo.names.join(', ')})`);
          }
          lines.push(`${chalk.cyan('Validation:')} ${chalk.green('passed')}`);

          console.log(
            boxen(lines.join('\n'), {
              padding: 1,
              borderColor: 'yellow',
              borderStyle: 'round',
              title: 'Dry Run',
              titleAlignment: 'center',
            })
          );

          PluginRegistry.getInstance().clear();
          return;
        }

        spinner.text = `Generating ${adapter.label}...`;
        const buffer = await factory.generate(documentDefinition, {
          theme: mergedConfig.theme,
          themePath: mergedConfig.themePath,
          validation: mergedConfig.validation,
        });

        spinner.text = 'Writing output file...';
        writeFileSync(outputPath, Buffer.from(buffer));

        spinner.succeed(
          `${adapter.label.charAt(0).toUpperCase() + adapter.label.slice(1)} generated successfully! ${formatTiming(startTime)}`
        );

        const lines = [
          `${chalk.cyan('Input:')}   ${input}`,
          `${chalk.cyan('Output:')}  ${shortPath(outputPath)}`,
          `${chalk.cyan('Format:')}  ${adapter.name}`,
        ];
        if (pluginInfo.hasPlugins) {
          lines.push(`${chalk.cyan('Plugins:')} ${pluginInfo.count} loaded (${pluginInfo.names.join(', ')})`);
        }

        console.log(
          boxen(lines.join('\n'), {
            padding: 1,
            borderColor: 'green',
            borderStyle: 'round',
            title: adapter.label.charAt(0).toUpperCase() + adapter.label.slice(1),
            titleAlignment: 'center',
          })
        );

        PluginRegistry.getInstance().clear();
      } catch (error: any) {
        spinner.fail(`${adapter.label.charAt(0).toUpperCase() + adapter.label.slice(1)} generation failed`);
        formatError(error);

        PluginRegistry.getInstance().clear();
        process.exit(EXIT_CODES.FAIL);
      }
    })
    .addHelpText(
      'after',
      `
${chalk.gray('Examples:')}
  $ jto ${adapter.name} generate doc.json                           ${chalk.dim('# Generate without plugins')}
  $ jto ${adapter.name} generate doc.json --plugins                 ${chalk.dim('# Auto-discover plugins')}
  $ jto ${adapter.name} generate doc.json --plugins weather,data    ${chalk.dim('# Use plugins by name')}
  $ jto ${adapter.name} generate doc.json --theme minimal           ${chalk.dim('# Use built-in theme')}
  $ jto ${adapter.name} generate doc.json --theme-path ./theme.json ${chalk.dim('# Use custom theme')}
  $ jto ${adapter.name} generate doc.json --dry-run                 ${chalk.dim('# Preview without writing')}
`
    );
}
