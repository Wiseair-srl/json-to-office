import { Command } from 'commander';
import { readFileSync, writeFileSync } from 'fs';
import { resolve, basename } from 'path';
import ora from 'ora';
import chalk from 'chalk';
import type { FormatAdapter } from '../format-adapter.js';
import { PluginRegistry } from '../services/plugin-registry.js';
import { PluginResolver } from '../services/plugin-resolver.js';
import { GeneratorFactory } from '../services/generator-factory.js';
import { PluginConfigService } from '../config/plugin-config.js';
import { loadPlugins } from './shared.js';

interface GenerateOptions {
  output?: string;
  template?: string;
  plugins?: string | boolean;
  pluginDir?: string;
  theme?: string;
  themePath?: string;
  strict?: boolean;
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
    .action(async (input: string, options: GenerateOptions) => {
      const spinner = ora('Initializing...').start();

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

        spinner.text = `Generating ${adapter.label}...`;
        const buffer = await factory.generate(documentDefinition, {
          theme: mergedConfig.theme,
          themePath: mergedConfig.themePath,
          validation: mergedConfig.validation,
        });

        const outputPath = options.output
          ? resolve(process.cwd(), options.output)
          : resolve(process.cwd(), basename(input, '.json') + adapter.extension);

        spinner.text = 'Writing output file...';
        writeFileSync(outputPath, Buffer.from(buffer));

        spinner.succeed(`${adapter.label.charAt(0).toUpperCase() + adapter.label.slice(1)} generated successfully!`);

        console.log(`\n${chalk.bold(`Output: ${adapter.label}`)}\n`);
        console.log(chalk.cyan('  Input:'), input);
        console.log(chalk.cyan('  Output:'), outputPath);
        console.log(chalk.cyan('  Format:'), adapter.name);

        const pluginInfo = factory.getPluginInfo();
        if (pluginInfo.hasPlugins) {
          console.log(
            chalk.cyan('  Plugins:'),
            `${pluginInfo.count} loaded (${pluginInfo.names.join(', ')})`
          );
        }

        PluginRegistry.getInstance().clear();
      } catch (error: any) {
        spinner.fail(`${adapter.label.charAt(0).toUpperCase() + adapter.label.slice(1)} generation failed`);

        if (error.code === 'ENOENT') {
          console.error(chalk.red(`File not found: ${input}`));
        } else if (error instanceof SyntaxError) {
          console.error(chalk.red('Invalid JSON in input file'));
          console.error(chalk.dim(error.message));
        } else {
          console.error(chalk.red(error.message));
          if (error.validationErrors) {
            console.error(chalk.yellow('\nValidation errors:'));
            error.validationErrors.forEach((err: any) => {
              console.error(
                chalk.red(`  - ${err.path || 'root'}: ${err.message}`)
              );
              if (err.suggestions) {
                err.suggestions.forEach((suggestion: string) => {
                  console.error(chalk.dim(`    -> ${suggestion}`));
                });
              }
            });
          }
          if (error.stack && !error.validationErrors) {
            console.error(chalk.dim('\nStack trace:'));
            console.error(chalk.dim(error.stack));
          }
        }

        PluginRegistry.getInstance().clear();
        process.exit(1);
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
`
    );
}
