import { describe, it, expect } from 'vitest';

/**
 * The `fonts` command module exports its CLI builder factory. The internal
 * helpers (parseWeightsOption, filenameFor) aren't exported — testing them
 * directly would require export-for-test surgery. Instead we verify the
 * public Command shape here, and rely on behavioral tests via CLI smoke tests
 * for the heavier paths (network-backed install).
 */
import { createFontsCommand } from '../fonts';
import { DocxFormatAdapter } from '../../format-adapter';

describe('createFontsCommand', () => {
  const cmd = createFontsCommand(new DocxFormatAdapter());

  it('registers the three subcommands', () => {
    const names = cmd.commands.map((c) => c.name()).sort();
    expect(names).toEqual(['inspect', 'install', 'list']);
  });

  it('list accepts an optional document argument + --fonts-dir', () => {
    const list = cmd.commands.find((c) => c.name() === 'list');
    expect(list).toBeDefined();
    // Optional document arg
    expect(list!.registeredArguments[0].required).toBe(false);
    // --fonts-dir option present with default ./fonts
    const fontsDirOpt = list!.options.find((o) => o.long === '--fonts-dir');
    expect(fontsDirOpt).toBeDefined();
    expect(fontsDirOpt!.defaultValue).toBe('./fonts');
  });

  it('inspect takes a required file argument', () => {
    const inspect = cmd.commands.find((c) => c.name() === 'inspect');
    expect(inspect).toBeDefined();
    expect(inspect!.registeredArguments[0].required).toBe(true);
  });

  it('install takes family + --weights + --italics + --dir', () => {
    const install = cmd.commands.find((c) => c.name() === 'install');
    expect(install).toBeDefined();
    expect(install!.registeredArguments[0].required).toBe(true);
    const longs = install!.options.map((o) => o.long);
    expect(longs).toContain('--weights');
    expect(longs).toContain('--italics');
    expect(longs).toContain('--dir');
  });
});
