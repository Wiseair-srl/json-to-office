import { describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { themes } from '@json-to-office/core-docx';
import { DocxFormatAdapter, PptxFormatAdapter } from '@json-to-office/jto-ops';
import { createGenerateCommand, defaultOutputName } from '../generate.js';
import { createValidateCommand } from '../validate.js';

/** Summary lines the command printed, captured from the mocked renderer. */
const { rendered, renderedTones } = vi.hoisted(() => ({
  rendered: [] as string[],
  renderedTones: [] as Array<string | undefined>,
}));

// `generate` calls `loadConfig()` with no startPath, so cosmiconfig walks up
// out of the repo. Without this, a stray `.json-to-office.config.*` anywhere
// above the checkout would silently supply a theme and fail these assertions.
vi.mock('../../config/plugin-config.js', async () => {
  const actual = await vi.importActual<
    typeof import('../../config/plugin-config.js')
  >('../../config/plugin-config.js');
  return {
    ...actual,
    PluginConfigService: {
      ...actual.PluginConfigService,
      getInstance: () => ({
        loadConfig: async () => null,
        mergeWithOptions: (options: unknown) => options,
      }),
    },
  };
});

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
    renderLines: async (lines: { text: string; tone?: string }[]) => {
      rendered.push(...lines.map((line) => line.text));
      renderedTones.push(...lines.map((line) => line.tone));
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

  it('offers a --renderer flag', () => {
    expect(command.options.map((option) => option.long)).toContain(
      '--renderer'
    );
  });

  it('passes the chosen backend to the generator', async () => {
    const adapter = new DocxFormatAdapter();
    const generateBuffer = vi.fn(async () => Buffer.from('preview'));
    const createGenerator = vi
      .spyOn(adapter, 'createGenerator')
      .mockResolvedValue({
        generateBuffer,
        hasPlugins: false,
        pluginNames: [],
      });
    const directory = mkdtempSync(join(tmpdir(), 'jto-renderer-'));
    const input = join(directory, 'input.json');
    writeFileSync(input, JSON.stringify({ name: 'docx', children: [] }));

    await createGenerateCommand(adapter).parseAsync(
      [input, '--dry-run', '--renderer', 'office-open'],
      { from: 'user' }
    );

    expect(createGenerator).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ renderer: 'office-open' })
    );
  });

  it('refuses a backend the format does not register, and names the real ones', async () => {
    const adapter = new DocxFormatAdapter();
    const createGenerator = vi.spyOn(adapter, 'createGenerator');
    const directory = mkdtempSync(join(tmpdir(), 'jto-renderer-bad-'));
    const input = join(directory, 'input.json');
    writeFileSync(input, JSON.stringify({ name: 'docx', children: [] }));

    // The command reports and exits rather than throwing. `formatError` reaches
    // stderr through a call *inside* the ui module, which the module mock above
    // cannot intercept — so the stream itself is what gets read.
    const exit = vi
      .spyOn(process, 'exit')
      .mockImplementation((() => undefined) as never);
    let printed = '';
    let exited = false;
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(((
      chunk: unknown
    ) => {
      printed += String(chunk);
      return true;
    }) as never);

    try {
      await createGenerateCommand(adapter).parseAsync(
        [input, '--dry-run', '--renderer', 'libreoffice'],
        { from: 'user' }
      );
    } finally {
      exited = exit.mock.calls.length > 0;
      exit.mockRestore();
      stderr.mockRestore();
    }

    expect(exited).toBe(true);
    expect(printed).toContain('Unknown docx renderer "libreoffice"');
    expect(printed).toContain('"docxjs", "office-open"');
    // Checked before any rendering work, so the generator is never built.
    expect(createGenerator).not.toHaveBeenCalled();
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

  it('shares one prepared model between quality and rendering', async () => {
    const adapter = new DocxFormatAdapter();
    const prepareDocument = vi.spyOn(adapter, 'prepareDocument');
    const analyzeQuality = vi.spyOn(adapter, 'analyzeQuality');
    const createGenerator = vi
      .spyOn(adapter, 'createGenerator')
      .mockResolvedValue({
        generateBuffer: async () => Buffer.from('preview'),
        hasPlugins: false,
        pluginNames: [],
      });
    const directory = mkdtempSync(join(tmpdir(), 'jto-prepared-'));
    const input = join(directory, 'input.json');
    writeFileSync(
      input,
      JSON.stringify({ name: 'docx', props: {}, children: [] })
    );

    await createGenerateCommand(adapter).parseAsync([input, '--dry-run'], {
      from: 'user',
    });

    expect(prepareDocument).toHaveBeenCalledOnce();
    const analyzed = analyzeQuality.mock.calls[0]?.[1]?.prepared;
    const rendered = createGenerator.mock.calls[0]?.[1]?.prepared;
    expect(analyzed).toBeDefined();
    expect(rendered).toBe(analyzed);
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
      'devportal',
    ]);

    expect(createGenerator).toHaveBeenCalledWith(
      [],
      expect.objectContaining({ theme: 'devportal' })
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
      JSON.stringify({ ...(themes as any).vermilion, name: 'from-file' })
    );

    const line = await summarizedTheme('jto-theme-summary-', report(), [
      '--theme',
      'devportal',
      '--theme-path',
      themeFile,
    ]);

    expect(line).toContain(themeFile);
    expect(line).not.toContain('devportal');
  });

  it("reports the document's own theme when none is requested", async () => {
    const line = await summarizedTheme('jto-theme-own-', report('vermilion'));

    expect(line).toContain('vermilion');
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

  async function runPptxValidation(document: unknown, flags: string[] = []) {
    const directory = mkdtempSync(join(tmpdir(), 'jto-validate-options-'));
    const input = join(directory, 'input.json');
    writeFileSync(input, JSON.stringify(document));
    rendered.length = 0;
    renderedTones.length = 0;
    const exit = vi
      .spyOn(process, 'exit')
      .mockImplementation((() => undefined) as never);

    try {
      await createValidateCommand(new PptxFormatAdapter()).parseAsync(
        [input, ...flags],
        { from: 'user' }
      );
    } finally {
      exit.mockRestore();
    }

    return rendered.map((text, index) => ({
      text,
      tone: renderedTones[index],
    }));
  }

  it('suppresses warning-only results in quiet mode', async () => {
    const lines = await runPptxValidation(
      {
        name: 'pptx',
        props: { slideWidth: 13.333, slideHeight: 7.5 },
        children: [
          {
            name: 'slide',
            props: {},
            children: [{ name: 'text', props: { text: 'Tiny', fontSize: 6 } }],
          },
        ],
      },
      ['--quiet']
    );

    expect(lines).toEqual([]);
  });

  it('keeps invalid results and errors in quiet mode', async () => {
    const lines = await runPptxValidation(
      { name: 'pptx', props: {}, children: [null] },
      ['--quiet']
    );

    expect(lines[0]?.text).toContain('FAIL');
    expect(lines.some((line) => line.tone === 'error')).toBe(true);
  });

  it('renders informational quality findings as info', async () => {
    const lines = await runPptxValidation({
      name: 'pptx',
      props: { slideWidth: 10, slideHeight: 7.5 },
      children: [{ name: 'slide', props: {}, children: [] }],
    });

    expect(lines).toContainEqual(
      expect.objectContaining({
        text: expect.stringContaining('Canvas is 4:3 legacy'),
        tone: 'info',
      })
    );
  });
});
