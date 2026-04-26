/**
 * `jto <format> fonts` — introspection + Google Fonts install helper.
 *
 *   list                       Show safe fonts, fonts in ./fonts, and optionally
 *                              fonts referenced in a JSON document.
 *   inspect <file.ttf>         Parse family/weight/italic/format/size from a TTF/OTF.
 *   install <family> [dir]     Download a Google Fonts family into ./fonts/ (or <dir>)
 *                              with filenames that --fonts-dir will auto-discover.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import {
  readFileSync,
  statSync,
  mkdirSync,
  writeFileSync,
  renameSync,
  unlinkSync,
} from 'node:fs';
import { resolve, basename, extname } from 'node:path';
import {
  SAFE_FONTS,
  collectFontNamesFromDocx,
  collectFontNamesFromPptx,
  detectFontFormat,
  fetchGoogleFontSources,
  isSafeFont,
  POPULAR_GOOGLE_FONTS,
} from '@json-to-office/shared';
import type { FormatAdapter } from '../format-adapter.js';
import { parseFontFilename, parseFontsDir } from './font-flags.js';
import { EXIT_CODES, formatError } from './ui.js';

/** Format a byte count as KB/MB. */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function weightLabel(weight: number, italic: boolean): string {
  return `${weight}${italic ? ' italic' : ''}`;
}

// ── list ────────────────────────────────────────────────────────────────────

interface ListOptions {
  fontsDir?: string;
}

function listSafeFonts(): void {
  console.log(
    chalk.bold('\nSafe fonts (bundled with Office, no embedding needed):')
  );
  for (const name of SAFE_FONTS) {
    console.log(`  ${chalk.cyan(name)}`);
  }
}

function listLocalFonts(dir: string): void {
  let entries;
  try {
    entries = parseFontsDir(dir);
  } catch (err) {
    console.log(
      chalk.yellow(
        `\n(--fonts-dir ${dir} not readable: ${(err as Error).message})`
      )
    );
    return;
  }
  if (entries.length === 0) {
    console.log(chalk.dim(`\nLocal fonts in ${dir}: (none)`));
    return;
  }
  console.log(chalk.bold(`\nLocal fonts in ${dir}:`));
  for (const e of entries) {
    const variants = e.sources
      .map((s) => {
        const weight = 'weight' in s ? s.weight ?? 400 : 400;
        const italic = 'italic' in s ? Boolean(s.italic) : false;
        return weightLabel(weight, italic);
      })
      .join(', ');
    console.log(`  ${chalk.cyan(e.family)}  ${chalk.dim(`(${variants})`)}`);
  }
}

function listReferencedFonts(
  docPath: string,
  adapterName: 'docx' | 'pptx'
): void {
  const absolutePath = resolve(process.cwd(), docPath);
  let raw: string;
  try {
    raw = readFileSync(absolutePath, 'utf-8');
  } catch (err) {
    console.log(
      chalk.yellow(`\n(Could not read ${docPath}: ${(err as Error).message})`)
    );
    return;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    console.log(
      chalk.yellow(
        `\n(${docPath} is not valid JSON: ${(err as Error).message})`
      )
    );
    return;
  }
  const names =
    adapterName === 'docx'
      ? collectFontNamesFromDocx(parsed)
      : collectFontNamesFromPptx(parsed);
  if (names.size === 0) {
    console.log(chalk.dim(`\nFonts referenced in ${docPath}: (none)`));
    return;
  }
  console.log(chalk.bold(`\nFonts referenced in ${docPath}:`));
  for (const name of [...names].sort()) {
    const status = isSafeFont(name)
      ? chalk.green('[safe]')
      : POPULAR_GOOGLE_FONTS.some(
            (g) => g.family.toLowerCase() === name.toLowerCase()
          )
        ? chalk.blue('[google]')
        : chalk.yellow('[unresolved]');
    console.log(`  ${chalk.cyan(name)}  ${status}`);
  }
}

function createListCommand(adapter: FormatAdapter): Command {
  return new Command('list')
    .description(
      'List safe fonts, fonts in ./fonts, and fonts referenced in a document'
    )
    .argument(
      '[document]',
      'Optional JSON document to scan for font references'
    )
    .option(
      '--fonts-dir <path>',
      'Directory of local .ttf/.otf files to list (default: ./fonts)',
      './fonts'
    )
    .action(async (document: string | undefined, options: ListOptions) => {
      listSafeFonts();
      if (options.fontsDir) listLocalFonts(options.fontsDir);
      if (document) {
        listReferencedFonts(document, adapter.name as 'docx' | 'pptx');
      }
      console.log();
    });
}

// ── inspect ─────────────────────────────────────────────────────────────────

function createInspectCommand(): Command {
  return new Command('inspect')
    .description('Print family/weight/italic/format/size for a .ttf/.otf file')
    .argument('<file>', 'Path to a font file')
    .action(async (file: string) => {
      const absolute = resolve(process.cwd(), file);
      let buf: Buffer;
      let size: number;
      try {
        buf = readFileSync(absolute);
        size = statSync(absolute).size;
      } catch (err) {
        formatError(err as Error);
        process.exit(EXIT_CODES.FAIL);
      }
      const format = detectFontFormat(buf);
      const parsed = parseFontFilename(basename(file));
      const ext = extname(file).toLowerCase();

      console.log();
      console.log(chalk.bold('Font:'), chalk.cyan(parsed.family));
      console.log(chalk.bold('File:'), file);
      console.log(
        chalk.bold('Format:'),
        format === 'unknown' ? chalk.yellow(format) : format
      );
      console.log(chalk.bold('Weight:'), parsed.weight);
      console.log(chalk.bold('Italic:'), parsed.italic ? 'yes' : 'no');
      console.log(chalk.bold('Size:'), formatBytes(size));
      if (format !== 'ttf' && format !== 'otf') {
        console.log(
          chalk.yellow(
            "\nWarning: embedding requires TTF or OTF. WOFF/WOFF2 won't embed in .docx."
          )
        );
      }
      if (parsed.family === basename(file, ext)) {
        console.log(
          chalk.dim(
            '\n(Family was not parsed from a recognized weight/style suffix — treating full filename as family.)'
          )
        );
      }
      console.log();
    });
}

// ── install ─────────────────────────────────────────────────────────────────

interface InstallOptions {
  weights?: string;
  italics?: boolean;
  dir?: string;
}

function parseWeightsOption(raw: string | undefined): number[] {
  if (!raw) return [400, 700];
  const out: number[] = [];
  for (const token of raw.split(/[,\s]+/).filter(Boolean)) {
    const n = parseInt(token, 10);
    if (Number.isNaN(n) || n < 100 || n > 900 || n % 100 !== 0) {
      throw new Error(
        `--weights must be 100-step integers between 100 and 900, got "${token}"`
      );
    }
    out.push(n);
  }
  return [...new Set(out)].sort((a, b) => a - b);
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
  const safeFamily = family.replace(/\s+/g, '');
  const suffix = `${WEIGHT_NAMES[weight] ?? weight}${italic ? 'Italic' : ''}`;
  return `${safeFamily}-${suffix}.ttf`;
}

function createInstallCommand(): Command {
  return new Command('install')
    .description(
      'Download a Google Fonts family into ./fonts/ (filenames compatible with --fonts-dir)'
    )
    .argument('<family>', 'Google Fonts family name (e.g. "Inter")')
    .option(
      '-w, --weights <list>',
      'Comma-separated weights (100..900, step 100). Default: "400,700"'
    )
    .option('--italics', 'Also download italic variants')
    .option(
      '-d, --dir <path>',
      'Output directory (default: ./fonts)',
      './fonts'
    )
    .action(async (family: string, options: InstallOptions) => {
      const weights = parseWeightsOption(options.weights);
      const italics = Boolean(options.italics);
      const outDir = resolve(process.cwd(), options.dir ?? './fonts');

      console.log(
        chalk.dim(
          `Fetching ${family} [${weights.join(', ')}]${italics ? ' + italics' : ''} from Google Fonts...`
        )
      );

      const { sources, warnings } = await fetchGoogleFontSources({
        family,
        weights,
        italics,
      });

      if (warnings.length > 0) {
        for (const w of warnings) console.warn(chalk.yellow(`  ${w}`));
      }
      if (sources.length === 0) {
        console.error(chalk.red(`\nNo variants downloaded for "${family}".`));
        process.exit(EXIT_CODES.FAIL);
      }

      mkdirSync(outDir, { recursive: true });
      // Atomic per-file writes: write to `<name>.tmp`, then rename. A crash
      // partway through an install leaves either the previous file or the
      // new one in place — never a half-written TTF. If any rename fails,
      // the already-written files remain so the user isn't left worse off.
      const written: string[] = [];
      const failures: { name: string; err: string }[] = [];
      for (const src of sources) {
        const name = filenameFor(family, src.weight, src.italic);
        const full = resolve(outDir, name);
        const tmp = `${full}.tmp`;
        try {
          writeFileSync(tmp, src.data);
          renameSync(tmp, full);
          written.push(name);
        } catch (err) {
          try {
            unlinkSync(tmp);
          } catch {
            // Already gone or never created — nothing to clean up.
          }
          failures.push({ name, err: (err as Error).message });
        }
      }

      if (failures.length > 0) {
        console.error(
          chalk.red(`\n${failures.length} file(s) failed to install:`)
        );
        for (const f of failures) {
          console.error(`  ${chalk.red(f.name)}: ${f.err}`);
        }
      }
      if (written.length > 0) {
        console.log(
          chalk.green(`\nInstalled ${written.length} file(s) into ${outDir}:`)
        );
        for (const name of written) console.log(`  ${chalk.cyan(name)}`);
        console.log(
          chalk.dim(
            `\nUse them with:  jto <format> generate doc.json --fonts-dir ${options.dir ?? './fonts'}`
          )
        );
      }
      if (failures.length > 0) {
        process.exit(EXIT_CODES.FAIL);
      }
    });
}

// ── exports ─────────────────────────────────────────────────────────────────

export function createFontsCommand(adapter: FormatAdapter): Command {
  const cmd = new Command('fonts').description(
    `Font introspection and Google Fonts install for ${adapter.label}s`
  );
  cmd.addCommand(createListCommand(adapter));
  cmd.addCommand(createInspectCommand());
  cmd.addCommand(createInstallCommand());
  cmd.addHelpText(
    'after',
    `
${chalk.gray('Examples:')}
  $ jto ${adapter.name} fonts list                         ${chalk.dim('# Safe + ./fonts')}
  $ jto ${adapter.name} fonts list doc.json                ${chalk.dim('# + fonts referenced in doc')}
  $ jto ${adapter.name} fonts inspect ./fonts/Inter-Bold.ttf
  $ jto ${adapter.name} fonts install Inter                ${chalk.dim('# → ./fonts/Inter-Regular.ttf + Inter-Bold.ttf')}
  $ jto ${adapter.name} fonts install "Playfair Display" --weights 400,700 --italics
`
  );
  return cmd;
}
