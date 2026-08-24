import { describe, it, expect } from 'vitest';
import { Command } from 'commander';
import { createDiffCommand } from '../diff';
import { registerCoreCommands } from '../../cli-register';
import { DocxFormatAdapter } from '@json-to-office/jto-ops';

describe('createDiffCommand', () => {
  const cmd = createDiffCommand(new DocxFormatAdapter());

  it('registers the expected arguments and options', () => {
    expect(cmd.name()).toBe('diff');
    const optionNames = cmd.options.map((o) => o.long);
    expect(optionNames).toEqual(
      expect.arrayContaining([
        '--output',
        '--author',
        '--date',
        '--json-out',
        '--format',
        '--dry-run',
      ])
    );
  });

  it('defaults output to redline.docx and author to json-to-office', () => {
    const opts = cmd.opts();
    expect(opts.output).toBe('redline.docx');
    expect(opts.author).toBe('json-to-office');
  });
});

describe('cli registration', () => {
  it('mounts diff under docx but not under pptx', () => {
    const program = registerCoreCommands(new Command());
    const docx = program.commands.find((c) => c.name() === 'docx')!;
    const pptx = program.commands.find((c) => c.name() === 'pptx')!;
    expect(docx.commands.map((c) => c.name())).toContain('diff');
    expect(pptx.commands.map((c) => c.name())).not.toContain('diff');
  });
});
