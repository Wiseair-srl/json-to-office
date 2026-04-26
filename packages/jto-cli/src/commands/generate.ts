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
import { parseFontFlag, parseFontsDir } from './font-flags.js';
import type { FontRegistryEntry } from '@json-to-office/shared';
import { isSafeFont } from '@json-to-office/shared';

interface GenerateOptions {
  output?: string;
  template?: string;
  plugins?: string | boolean;
  pluginDir?: string;
  theme?: string;
  themePath?: string;
  strict?: boolean;
  dryRun?: boolean;
  strictFonts?: boolean;
  noGoogleFonts?: boolean;
  fontCacheDir?: string;
  font?: string[];
  fontsDir?: string;
  fontMode?: 'substitute' | 'custom';
  fontSubstitute?: string[];
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
    .option(
      '--theme-path <path>',
      'Path to theme file (alternative to --theme)'
    )
    .option('--strict', 'Enable strict validation')
    .option(
      '--strict-fonts',
      'Fail generation on unresolved fontRegistry references'
    )
    .option(
      '--no-google-fonts',
      'Disable Google Fonts HTTP fetching (offline/CI builds)'
    )
    .option(
      '--font-cache-dir <path>',
      'Directory to cache fetched Google Fonts TTFs'
    )
    .option(
      '--font <name=path>',
      'Register a font file (repeatable): <family>=<path to .ttf/.otf>',
      (value: string, previous: string[] = []) => [...previous, value],
      [] as string[]
    )
    .option(
      '--fonts-dir <path>',
      'Scan directory for .ttf/.otf files and auto-register by filename'
    )
    .option(
      '--font-mode <mode>',
      'How to handle non-safe fonts: "custom" (default; keep refs as-is — recipient needs fonts installed) or "substitute" (rewrite to safe fonts)',
      (value: string) => {
        if (value !== 'substitute' && value !== 'custom') {
          throw new Error(
            `--font-mode must be one of: substitute, custom (got "${value}")`
          );
        }
        return value;
      }
    )
    .option(
      '--font-substitute <family=safe>',
      'When --font-mode substitute: map a non-safe family to a specific safe font (repeatable). Falls back to category defaults when omitted.',
      (value: string, previous: string[] = []) => [...previous, value],
      [] as string[]
    )
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

        await loadPlugins(
          options,
          config,
          configService,
          spinner,
          adapter.name as 'docx' | 'pptx'
        );

        spinner.text = 'Reading input file...';
        const inputPath = resolve(process.cwd(), input);
        const jsonContent = readFileSync(inputPath, 'utf-8');
        const documentDefinition = JSON.parse(jsonContent);

        const factory = new GeneratorFactory(adapter);

        const outputPath = options.output
          ? resolve(process.cwd(), options.output)
          : resolve(
              process.cwd(),
              basename(input, '.json') + adapter.extension
            );

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
            lines.push(
              `${chalk.cyan('Plugins:')}    ${pluginInfo.count} loaded (${pluginInfo.names.join(', ')})`
            );
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

        // Build font registry entries from CLI flags. --font is repeatable;
        // --fonts-dir scans a directory and coalesces sibling files into a
        // single entry per family.
        const extraEntries: FontRegistryEntry[] = [];
        for (const spec of options.font ?? []) {
          extraEntries.push(parseFontFlag(spec));
        }
        if (options.fontsDir) {
          extraEntries.push(...parseFontsDir(options.fontsDir));
        }

        // Parse --font-substitute family=safe pairs into the mapping shape
        // FontRuntimeOpts expects.
        const substitution: Record<string, string> = {};
        for (const spec of options.fontSubstitute ?? []) {
          const eq = spec.indexOf('=');
          if (eq < 0) {
            throw new Error(
              `--font-substitute expects <family>=<safe-font>, got "${spec}"`
            );
          }
          const from = spec.slice(0, eq).trim();
          const to = spec.slice(eq + 1).trim();
          if (!from || !to) {
            throw new Error(
              `--font-substitute expects non-empty family and safe-font, got "${spec}"`
            );
          }
          if (!isSafeFont(to)) {
            throw new Error(
              `--font-substitute target "${to}" is not in SAFE_FONTS (got "${spec}")`
            );
          }
          substitution[from] = to;
        }

        spinner.text = `Generating ${adapter.label}...`;
        const buffer = await factory.generate(documentDefinition, {
          theme: mergedConfig.theme,
          themePath: mergedConfig.themePath,
          validation: mergedConfig.validation,
          fonts: {
            strict: options.strictFonts,
            ...(extraEntries.length > 0 && { extraEntries }),
            ...(options.fontMode && { mode: options.fontMode }),
            ...(Object.keys(substitution).length > 0 && { substitution }),
            googleFonts: {
              ...(options.noGoogleFonts === true && { enabled: false }),
              ...(options.fontCacheDir && {
                cacheDir: resolve(process.cwd(), options.fontCacheDir),
              }),
            },
          },
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
          lines.push(
            `${chalk.cyan('Plugins:')} ${pluginInfo.count} loaded (${pluginInfo.names.join(', ')})`
          );
        }

        console.log(
          boxen(lines.join('\n'), {
            padding: 1,
            borderColor: 'green',
            borderStyle: 'round',
            title:
              adapter.label.charAt(0).toUpperCase() + adapter.label.slice(1),
            titleAlignment: 'center',
          })
        );

        PluginRegistry.getInstance().clear();
      } catch (error: any) {
        spinner.fail(
          `${adapter.label.charAt(0).toUpperCase() + adapter.label.slice(1)} generation failed`
        );
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
  $ jto ${adapter.name} generate doc.json --strict-fonts            ${chalk.dim('# Fail on unresolved fonts')}
  $ jto ${adapter.name} generate doc.json --font-cache-dir .fontcache ${chalk.dim('# Cache Google Fonts TTFs')}
  $ jto ${adapter.name} generate doc.json --no-google-fonts         ${chalk.dim('# Offline build, skip network fetches')}
  $ jto ${adapter.name} generate doc.json --font Inter=./fonts/Inter-Regular.ttf ${chalk.dim('# Register one TTF')}
  $ jto ${adapter.name} generate doc.json --fonts-dir ./fonts       ${chalk.dim('# Auto-register every .ttf/.otf in ./fonts')}
`
    );
}
