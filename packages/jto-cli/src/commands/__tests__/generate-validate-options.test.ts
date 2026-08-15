import { describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { themes } from '@json-to-office/core-docx';
import { DocxFormatAdapter } from '../../format-adapter.js';
import { createGenerateCommand, defaultOutputName } from '../generate.js';
import { createValidateCommand } from '../validate.js';

/** Summary lines the command printed, captured from the mocked renderer. */
const { rendered } = vi.hoisted(() => ({ rendered: [] as string[] }));

vi.mock('../ui.js', async () => {
  const actual = await vi.importActual<typeof import('../ui.js')>('../ui.js');
  return {
    ...actual,
    runTask: async (
      _initial: string,
      task: (reporter: {
        update(message: string): void;
        log(message: string): void;
      }) => Promise<unknown>
    ) => task({ update: () => undefined, log: () => undefined }),
    renderLines: async (lines: { text: string }[]) => {
      rendered.push(...lines.map((line) => line.text));
    },
  };
});

describe('generate command contract', () => {
  const command = createGenerateCommand(new DocxFormatAdapter());

  it('defaults to reproducible output and accepts a fixed clock', () => {
    expect(command.opts().deterministic).toBe(true);
    expect(command.options.map((option) => option.long)).toEqual(
      expect.arrayContaining([
        '--deterministic',
        '--no-deterministic',
        '--generated-at',
      ])
    );
  });

  it('does not duplicate format extension for *.docx.json input', () => {
    expect(defaultOutputName('invoice.docx.json', '.docx')).toBe(
      'invoice.docx'
    );
    expect(defaultOutputName('invoice.json', '.docx')).toBe('invoice.docx');
  });

  it('generates a validated preview on dry run without writing', async () => {
    const adapter = new DocxFormatAdapter();
    const generateBuffer = vi.fn(async () => Buffer.from('preview'));
    vi.spyOn(adapter, 'createGenerator').mockResolvedValue({
      generateBuffer,
      hasPlugins: false,
      pluginNames: [],
    });
    const directory = mkdtempSync(join(tmpdir(), 'jto-dry-run-'));
    const input = join(directory, 'input.json');
    const output = join(directory, 'output.docx');
    writeFileSync(input, JSON.stringify({ name: 'docx', children: [] }));

    await createGenerateCommand(adapter).parseAsync(
      [input, '--dry-run', '--output', output],
      { from: 'user' }
    );

    expect(generateBuffer).toHaveBeenCalledOnce();
    expect(existsSync(output)).toBe(false);
  });

  /** Run `generate --dry-run` with `flags` and return the spied createGenerator. */
  async function runWithFlags(prefix: string, flags: string[]) {
    const adapter = new DocxFormatAdapter();
    const createGenerator = vi
      .spyOn(adapter, 'createGenerator')
      .mockResolvedValue({
        generateBuffer: async () => Buffer.from('preview'),
        hasPlugins: false,
        pluginNames: [],
      });
    const directory = mkdtempSync(join(tmpdir(), prefix));
    const input = join(directory, 'input.json');
    writeFileSync(input, JSON.stringify({ name: 'docx', children: [] }));

    await createGenerateCommand(adapter).parseAsync(
      [input, '--dry-run', ...flags],
      { from: 'user' }
    );

    return createGenerator;
  }

  it('turns --no-google-fonts into googleFonts.enabled=false', async () => {
    const cacheDir = join(tmpdir(), 'jto-font-cache');

    const createGenerator = await runWithFlags('jto-font-flags-', [
      '--no-google-fonts',
      '--font-cache-dir',
      cacheDir,
    ]);

    expect(createGenerator).toHaveBeenCalledWith(
      [],
      expect.objectContaining({
        fonts: expect.objectContaining({
          googleFonts: { enabled: false, cacheDir },
        }),
      })
    );
  });

  // Control: theme forwarding predates the font-flag fix above. Kept so a
  // refactor of the option plumbing cannot drop it unnoticed.
  it('forwards --theme to the generator', async () => {
    const createGenerator = await runWithFlags('jto-theme-flag-', [
      '--theme',
      'modern',
    ]);

    expect(createGenerator).toHaveBeenCalledWith(
      [],
      expect.objectContaining({ theme: 'modern' })
    );
  });

  /** `generate --dry-run` on `document` with `flags`; returns the Theme line. */
  async function summarizedTheme(
    prefix: string,
    document: unknown,
    flags: string[] = []
  ) {
    const directory = mkdtempSync(join(tmpdir(), prefix));
    const input = join(directory, 'input.json');
    writeFileSync(input, JSON.stringify(document));
    rendered.length = 0;

    await createGenerateCommand(new DocxFormatAdapter()).parseAsync(
      [input, '--dry-run', ...flags],
      { from: 'user' }
    );

    return rendered.find((line) => line.includes('Theme:'));
  }

  const report = (theme?: string) => ({
    name: 'docx',
    props: theme ? { theme } : {},
    children: [{ name: 'paragraph', props: { text: 'Hello' } }],
  });

  it('reports the theme file when --theme-path outranks --theme', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'jto-theme-file-'));
    const themeFile = join(directory, 'filetheme.json');
    writeFileSync(
      themeFile,
      JSON.stringify({ ...(themes as any).corporate, name: 'from-file' })
    );

    const line = await summarizedTheme('jto-theme-summary-', report(), [
      '--theme',
      'modern',
      '--theme-path',
      themeFile,
    ]);

    expect(line).toContain(themeFile);
    expect(line).not.toContain('modern');
  });

  it("reports the document's own theme when none is requested", async () => {
    const line = await summarizedTheme('jto-theme-own-', report('corporate'));

    expect(line).toContain('corporate');
    expect(line).not.toContain('default');
  });
});

describe('validate command contract', () => {
  const command = createValidateCommand(new DocxFormatAdapter());

  it('keeps human, quiet, and machine output modes', () => {
    expect(command.opts()).toMatchObject({ type: 'auto', format: 'pretty' });
    expect(command.options.map((option) => option.long)).toEqual(
      expect.arrayContaining(['--quiet', '--format', '--recursive'])
    );
  });
});
