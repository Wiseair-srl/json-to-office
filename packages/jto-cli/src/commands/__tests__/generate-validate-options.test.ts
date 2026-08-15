import { describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DocxFormatAdapter } from '../../format-adapter.js';
import { createGenerateCommand, defaultOutputName } from '../generate.js';
import { createValidateCommand } from '../validate.js';

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
    renderLines: async () => undefined,
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
