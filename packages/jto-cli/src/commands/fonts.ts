import { Command } from 'commander';
import {
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { basename, extname, resolve } from 'node:path';
import chalk from 'chalk';
import {
  SAFE_FONTS,
  collectFontNamesFromDocx,
  collectFontNamesFromPptx,
  detectFontFormat,
  fetchGoogleFontSources,
  isSafeFont,
  POPULAR_GOOGLE_FONTS,
} from '@json-to-office/shared';
import type { FormatAdapter } from '@json-to-office/jto-ops';
import { parseFontFilename, parseFontsDir } from './font-flags.js';
import {
  EXIT_CODES,
  formatError,
  renderLines,
  runTask,
  type UiLine,
} from './ui.js';
import { exitAfterFlush } from './exit.js';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function weightLabel(weight: number, italic: boolean): string {
  return `${weight}${italic ? ' italic' : ''}`;
}

interface ListOptions {
  fontsDir?: string;
}

function safeFontLines(): UiLine[] {
  return [
    { text: 'Safe fonts (bundled with Office):', tone: 'info' },
    ...SAFE_FONTS.map((name) => ({
      text: `  ${name}`,
      tone: 'default' as const,
    })),
  ];
}

function localFontLines(dir: string): UiLine[] {
  try {
    const entries = parseFontsDir(dir);
    if (entries.length === 0)
      return [{ text: `Local fonts in ${dir}: none`, tone: 'muted' }];
    return [
      { text: `Local fonts in ${dir}:`, tone: 'info' },
      ...entries.map((entry) => ({
        text: `  ${entry.family} (${entry.sources
          .map((source) =>
            weightLabel(
              'weight' in source ? source.weight ?? 400 : 400,
              'italic' in source ? Boolean(source.italic) : false
            )
          )
          .join(', ')})`,
      })),
    ];
  } catch (error) {
    return [
      {
        text: `--fonts-dir ${dir} not readable: ${(error as Error).message}`,
        tone: 'warning',
      },
    ];
  }
}

function referencedFontLines(
  docPath: string,
  adapterName: 'docx' | 'pptx'
): UiLine[] {
  try {
    const parsed = JSON.parse(
      readFileSync(resolve(process.cwd(), docPath), 'utf-8')
    );
    const names =
      adapterName === 'docx'
        ? collectFontNamesFromDocx(parsed)
        : collectFontNamesFromPptx(parsed);
    if (names.size === 0) {
      return [{ text: `Fonts referenced in ${docPath}: none`, tone: 'muted' }];
    }
    return [
      { text: `Fonts referenced in ${docPath}:`, tone: 'info' },
      ...[...names].sort().map((name) => {
        const status = isSafeFont(name)
          ? 'safe'
          : POPULAR_GOOGLE_FONTS.some(
                (font) => font.family.toLowerCase() === name.toLowerCase()
              )
            ? 'google'
            : 'unresolved';
        return {
          text: `  ${name} [${status}]`,
          tone:
            status === 'unresolved'
              ? ('warning' as const)
              : ('default' as const),
        };
      }),
    ];
  } catch (error) {
    return [
      { text: `${docPath}: ${(error as Error).message}`, tone: 'warning' },
    ];
  }
}

function createListCommand(adapter: FormatAdapter): Command {
  return new Command('list')
    .description('List safe, local, and document-referenced fonts')
    .argument(
      '[document]',
      'Optional JSON document to scan for font references'
    )
    .option(
      '--fonts-dir <path>',
      'Directory of local .ttf/.otf files',
      './fonts'
    )
    .action(async (document: string | undefined, options: ListOptions) => {
      await renderLines([
        ...safeFontLines(),
        ...(options.fontsDir ? localFontLines(options.fontsDir) : []),
        ...(document
          ? referencedFontLines(document, adapter.name as 'docx' | 'pptx')
          : []),
      ]);
    });
}

function createInspectCommand(): Command {
  return new Command('inspect')
    .description('Print family/weight/italic/format/size for a font file')
    .argument('<file>', 'Path to a font file')
    .action(async (file: string) => {
      try {
        const absolute = resolve(process.cwd(), file);
        const buffer = readFileSync(absolute);
        const size = statSync(absolute).size;
        const format = detectFontFormat(buffer);
        const parsed = parseFontFilename(basename(file));
        const extension = extname(file).toLowerCase();
        const lines: UiLine[] = [
          { text: `Font: ${parsed.family}`, tone: 'info' },
          { text: `File: ${file}` },
          {
            text: `Format: ${format}`,
            tone: format === 'unknown' ? 'warning' : 'default',
          },
          { text: `Weight: ${parsed.weight}` },
          { text: `Italic: ${parsed.italic ? 'yes' : 'no'}` },
          { text: `Size: ${formatBytes(size)}` },
        ];
        if (format !== 'ttf' && format !== 'otf') {
          lines.push({
            text: "Embedding requires TTF or OTF. WOFF/WOFF2 won't embed in DOCX.",
            tone: 'warning',
          });
        }
        if (parsed.family === basename(file, extension)) {
          lines.push({
            text: 'Family not parsed from weight/style suffix; using full filename.',
            tone: 'muted',
          });
        }
        await renderLines(lines);
      } catch (error) {
        await formatError(error);
        await exitAfterFlush(EXIT_CODES.FAIL);
      }
    });
}

interface InstallOptions {
  weights?: string;
  italics?: boolean;
  dir?: string;
}

function parseWeightsOption(raw: string | undefined): number[] {
  if (!raw) return [400, 700];
  const values = raw
    .split(/[,\s]+/)
    .filter(Boolean)
    .map((token) => {
      const value = parseInt(token, 10);
      if (
        Number.isNaN(value) ||
        value < 100 ||
        value > 900 ||
        value % 100 !== 0
      ) {
        throw new Error(
          `--weights must be 100-step integers from 100 to 900, got "${token}"`
        );
      }
      return value;
    });
  return [...new Set(values)].sort((left, right) => left - right);
}

const WEIGHT_NAMES: Record<number, string> = {
  100: 'Thin',
  200: 'ExtraLight',
  300: 'Light',
  400: 'Regular',
  500: 'Medium',
  600: 'SemiBold',
  700: 'Bold',
  800: 'ExtraBold',
  900: 'Black',
};

function filenameFor(family: string, weight: number, italic: boolean): string {
  const suffix = `${WEIGHT_NAMES[weight] ?? weight}${italic ? 'Italic' : ''}`;
  return `${family.replace(/\s+/g, '')}-${suffix}.ttf`;
}

function createInstallCommand(): Command {
  return new Command('install')
    .description('Download a Google Fonts family into ./fonts/')
    .argument('<family>', 'Google Fonts family name')
    .option('-w, --weights <list>', 'Comma-separated weights; default 400,700')
    .option('--italics', 'Also download italic variants')
    .option('-d, --dir <path>', 'Output directory', './fonts')
    .action(async (family: string, options: InstallOptions) => {
      try {
        const weights = parseWeightsOption(options.weights);
        const italics = Boolean(options.italics);
        const outputDirectory = resolve(
          process.cwd(),
          options.dir ?? './fonts'
        );
        const written = await runTask(
          `Fetching ${family} from Google Fonts...`,
          async (reporter) => {
            const result = await fetchGoogleFontSources({
              family,
              weights,
              italics,
            });
            for (const warning of result.warnings)
              reporter.log(warning, 'warning');
            if (result.sources.length === 0) {
              throw new Error(`No variants downloaded for "${family}".`);
            }
            reporter.update('Installing font files...');
            mkdirSync(outputDirectory, { recursive: true });
            const installed: string[] = [];
            const failures: string[] = [];
            for (const source of result.sources) {
              const name = filenameFor(family, source.weight, source.italic);
              const fullPath = resolve(outputDirectory, name);
              const temporaryPath = `${fullPath}.tmp`;
              try {
                writeFileSync(temporaryPath, source.data);
                renameSync(temporaryPath, fullPath);
                installed.push(name);
              } catch (error) {
                try {
                  unlinkSync(temporaryPath);
                } catch {
                  // Nothing to clean up.
                }
                failures.push(`${name}: ${(error as Error).message}`);
              }
            }
            if (failures.length > 0) {
              throw new Error(
                `${failures.length} file(s) failed:\n${failures.join('\n')}`
              );
            }
            return installed;
          },
          {
            success: (files) => `Installed ${files.length} font file(s)`,
            failure: 'Font install failed',
          }
        );
        await renderLines([
          { text: outputDirectory, tone: 'success' },
          ...written.map((name) => ({ text: `  ${name}` })),
          {
            text: `Use: jto <format> generate doc.json --fonts-dir ${options.dir ?? './fonts'}`,
            tone: 'muted',
          },
        ]);
      } catch (error) {
        await formatError(error);
        await exitAfterFlush(EXIT_CODES.FAIL);
      }
    });
}

export function createFontsCommand(adapter: FormatAdapter): Command {
  const command = new Command('fonts').description(
    `Font introspection and Google Fonts install for ${adapter.label}s`
  );
  command.addCommand(createListCommand(adapter));
  command.addCommand(createInspectCommand());
  command.addCommand(createInstallCommand());
  command.addHelpText(
    'after',
    `
${chalk.gray('Examples:')}
  $ jto ${adapter.name} fonts list
  $ jto ${adapter.name} fonts list doc.json
  $ jto ${adapter.name} fonts inspect ./fonts/Inter-Bold.ttf
  $ jto ${adapter.name} fonts install Inter
`
  );
  return command;
}
