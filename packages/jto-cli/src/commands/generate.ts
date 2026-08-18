import { Command } from 'commander';
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import chalk from 'chalk';
import type { FormatAdapter, GeneratorResult } from '../format-adapter.js';
import { PluginRegistry } from '../services/plugin-registry.js';
import { GeneratorFactory } from '../services/generator-factory.js';
import { PluginConfigService } from '../config/plugin-config.js';
import { loadPlugins } from './shared.js';
import {
  shortPath,
  formatTiming,
  formatError,
  renderLines,
  runTask,
  EXIT_CODES,
} from './ui.js';
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
  /** Commander maps `--no-google-fonts` here: false when the flag is passed. */
  googleFonts?: boolean;
  fontCacheDir?: string;
  font?: string[];
  fontsDir?: string;
  fontMode?: 'substitute' | 'custom';
  fontSubstitute?: string[];
  deterministic?: boolean;
  generatedAt?: string;
}

interface GenerateSummary {
  input: string;
  output: string;
  theme: string;
  dryRun: boolean;
  plugins: string[];
}

function parseGeneratedAt(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid --generated-at: "${value}" (expected ISO 8601)`);
  }
  return parsed.toISOString();
}

/**
 * What to print on the `Theme:` line. `themeLabel` is what the adapter really
 * resolved — `--theme-path` outranks `--theme`, and a rejected name resolves to
 * nothing at all — and with none requested the document's own `props.theme` is
 * what renders. Reading the merged config instead misreports both cases.
 */
function themeSummary(themeLabel: string | undefined, document: any): string {
  if (themeLabel) return themeLabel;
  const own = document?.props?.theme;
  if (typeof own === 'string' && own) return own;
  if (own && typeof own === 'object') return own.name || 'custom';
  return 'default';
}

export function defaultOutputName(input: string, extension: string): string {
  const stem = basename(input, '.json');
  return stem.endsWith(extension) ? stem : `${stem}${extension}`;
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
    .option('--strict', 'Compatibility flag; validation is strict by default')
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
      'How to handle non-safe fonts: custom or substitute',
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
      'Map a non-safe family to a safe font (repeatable)',
      (value: string, previous: string[] = []) => [...previous, value],
      [] as string[]
    )
    .option('--deterministic', 'Produce reproducible Office archives', true)
    .option(
      '--no-deterministic',
      'Allow timestamps and other volatile metadata'
    )
    .option('--generated-at <iso>', 'Generation timestamp (ISO 8601)')
    .option('--dry-run', 'Preview without writing files')
    .action(async (input: string, options: GenerateOptions) => {
      const startTime = performance.now();
      try {
        const summary = await runTask<GenerateSummary>(
          'Initializing...',
          async (reporter) => {
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
              reporter,
              adapter.name as 'docx' | 'pptx'
            );

            reporter.update('Reading input file...');
            const inputPath = resolve(process.cwd(), input);
            const documentDefinition = JSON.parse(
              readFileSync(inputPath, 'utf-8')
            );
            const outputPath = options.output
              ? resolve(process.cwd(), options.output)
              : resolve(
                  process.cwd(),
                  defaultOutputName(input, adapter.extension)
                );
            const factory = new GeneratorFactory(adapter);
            const pluginInfo = factory.getPluginInfo();

            const extraEntries: FontRegistryEntry[] = [];
            for (const spec of options.font ?? [])
              extraEntries.push(parseFontFlag(spec));
            if (options.fontsDir)
              extraEntries.push(...parseFontsDir(options.fontsDir));

            const substitution: Record<string, string> = {};
            for (const spec of options.fontSubstitute ?? []) {
              const eq = spec.indexOf('=');
              const from = eq >= 0 ? spec.slice(0, eq).trim() : '';
              const to = eq >= 0 ? spec.slice(eq + 1).trim() : '';
              if (!from || !to) {
                throw new Error(
                  `--font-substitute expects <family>=<safe-font>, got "${spec}"`
                );
              }
              if (!isSafeFont(to)) {
                throw new Error(
                  `--font-substitute target "${to}" is not in SAFE_FONTS (got "${spec}")`
                );
              }
              substitution[from] = to;
            }

            reporter.update(
              options.dryRun
                ? `Validating ${adapter.label} preview...`
                : `Generating ${adapter.label}...`
            );
            const generator: GeneratorResult = await factory.createGenerator({
              theme: mergedConfig.theme,
              themePath: mergedConfig.themePath,
              validation: mergedConfig.validation,
              deterministic: options.deterministic,
              generatedAt: parseGeneratedAt(options.generatedAt),
              // Relative asset paths resolve against the document's own
              // directory, not the invocation cwd (#142).
              baseDir: dirname(inputPath),
              fonts: {
                strict: options.strictFonts,
                ...(extraEntries.length > 0 && { extraEntries }),
                ...(options.fontMode && { mode: options.fontMode }),
                ...(Object.keys(substitution).length > 0 && { substitution }),
                googleFonts: {
                  ...(options.googleFonts === false && { enabled: false }),
                  ...(options.fontCacheDir && {
                    cacheDir: resolve(process.cwd(), options.fontCacheDir),
                  }),
                },
              },
            });
            const buffer = await generator.generateBuffer(documentDefinition);

            if (!options.dryRun) {
              reporter.update('Writing output file...');
              writeFileSync(outputPath, Buffer.from(buffer));
            }

            return {
              input,
              output: outputPath,
              theme: themeSummary(generator.themeLabel, documentDefinition),
              dryRun: Boolean(options.dryRun),
              plugins: pluginInfo.names,
            };
          },
          {
            success: (result) =>
              `${result.dryRun ? 'Dry run complete' : `${adapter.label} generated`} ${formatTiming(startTime)}`,
            failure: `${adapter.label} generation failed`,
          }
        );

        await renderLines([
          { text: `${chalk.cyan('Input:')}   ${summary.input}` },
          { text: `${chalk.cyan('Output:')}  ${shortPath(summary.output)}` },
          { text: `${chalk.cyan('Format:')}  ${adapter.name}` },
          { text: `${chalk.cyan('Theme:')}   ${summary.theme}` },
          ...(summary.plugins.length > 0
            ? [
                {
                  text: `${chalk.cyan('Plugins:')} ${summary.plugins.join(', ')}`,
                },
              ]
            : []),
          ...(summary.dryRun
            ? [
                {
                  text: `${chalk.cyan('Validation:')} passed`,
                  tone: 'success' as const,
                },
              ]
            : []),
        ]);
      } catch (error: any) {
        await formatError(error);
        process.exit(EXIT_CODES.FAIL);
      } finally {
        PluginRegistry.getInstance().clear();
      }
    })
    .addHelpText(
      'after',
      `
${chalk.gray('Examples:')}
  $ jto ${adapter.name} generate doc.json
  $ jto ${adapter.name} generate doc.json --plugins weather,data
  $ jto ${adapter.name} generate doc.json --theme minimal
  $ jto ${adapter.name} generate doc.json --dry-run
  $ jto ${adapter.name} generate doc.json --no-deterministic
  $ jto ${adapter.name} generate doc.json --generated-at 2026-01-01T00:00:00Z
`
    );
}
