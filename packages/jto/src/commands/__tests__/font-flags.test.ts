import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseFontFilename, parseFontFlag, parseFontsDir } from '../font-flags';

describe('parseFontFilename', () => {
  it('parses family + numeric weight', () => {
    expect(parseFontFilename('Inter-500.ttf')).toEqual({
      family: 'Inter',
      weight: 500,
      italic: false,
    });
  });

  it('parses family + named weight', () => {
    expect(parseFontFilename('Inter-Bold.ttf')).toEqual({
      family: 'Inter',
      weight: 700,
      italic: false,
    });
  });

  it('parses italic suffix without weight', () => {
    expect(parseFontFilename('Inter-Italic.otf')).toEqual({
      family: 'Inter',
      weight: 400,
      italic: true,
    });
  });

  it('parses combined weight + italic', () => {
    expect(parseFontFilename('Inter-BoldItalic.ttf')).toEqual({
      family: 'Inter',
      weight: 700,
      italic: true,
    });
  });

  it('handles numeric + italic', () => {
    expect(parseFontFilename('Roboto-500italic.ttf')).toEqual({
      family: 'Roboto',
      weight: 500,
      italic: true,
    });
  });

  it('handles multi-word family names', () => {
    expect(parseFontFilename('Plus Jakarta Sans-Regular.ttf')).toEqual({
      family: 'Plus Jakarta Sans',
      weight: 400,
      italic: false,
    });
  });

  it('handles underscore separators', () => {
    expect(parseFontFilename('Roboto_Bold.ttf')).toEqual({
      family: 'Roboto',
      weight: 700,
      italic: false,
    });
  });

  it('falls back gracefully on unrecognized suffix', () => {
    expect(parseFontFilename('BrandPro-v2.ttf')).toEqual({
      family: 'BrandPro-v2',
      weight: 400,
      italic: false,
    });
  });

  it('handles single-word filename', () => {
    expect(parseFontFilename('Inter.ttf')).toEqual({
      family: 'Inter',
      weight: 400,
      italic: false,
    });
  });

  it('rejects numeric weights outside 100-900', () => {
    expect(parseFontFilename('Inter-50.ttf')).toEqual({
      family: 'Inter-50',
      weight: 400,
      italic: false,
    });
  });
});

describe('parseFontFlag', () => {
  const cwd = '/tmp/test-cwd';

  it('parses <family>=<path>', () => {
    const entry = parseFontFlag('Inter=./fonts/Inter-Regular.ttf', cwd);
    expect(entry.id).toBe('Inter');
    expect(entry.family).toBe('Inter');
    expect(entry.sources).toHaveLength(1);
    expect(entry.sources[0]).toMatchObject({
      kind: 'file',
      weight: 400,
      italic: false,
    });
    // Path is resolved to absolute
    expect((entry.sources[0] as { path: string }).path).toBe(
      path.resolve(cwd, './fonts/Inter-Regular.ttf')
    );
  });

  it('infers weight/italic from the filename', () => {
    const entry = parseFontFlag('MyBrand=./fonts/Brand-BoldItalic.otf', cwd);
    expect(entry.sources[0]).toMatchObject({ weight: 700, italic: true });
  });

  it('allows the display family to differ from the filename stem', () => {
    const entry = parseFontFlag('Brand=./fonts/Custom-Light.ttf', cwd);
    expect(entry.family).toBe('Brand');
    // The weight is still derived from the filename
    expect(entry.sources[0]).toMatchObject({ weight: 300 });
  });

  it('throws on missing =', () => {
    expect(() => parseFontFlag('./fonts/Inter.ttf', cwd)).toThrow(
      /expects <name>=<path>/
    );
  });

  it('throws on empty name or path', () => {
    expect(() => parseFontFlag('=./x.ttf', cwd)).toThrow(/empty/);
    expect(() => parseFontFlag('Inter=', cwd)).toThrow(/empty/);
  });
});

describe('parseFontsDir', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(os.tmpdir(), 'jto-fontsdir-test-'));
  });
  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  async function write(name: string, content = 'stub'): Promise<string> {
    const p = path.join(tempDir, name);
    await fs.writeFile(p, content);
    return p;
  }

  it('coalesces sibling weights into one entry per family', async () => {
    await write('Inter-Regular.ttf');
    await write('Inter-Bold.ttf');
    await write('Inter-Italic.ttf');
    const entries = parseFontsDir(tempDir);
    expect(entries).toHaveLength(1);
    expect(entries[0].family).toBe('Inter');
    expect(entries[0].sources).toHaveLength(3);
    const weights = entries[0].sources
      .map((s) => ('weight' in s ? s.weight : undefined))
      .sort();
    expect(weights).toEqual([400, 400, 700]);
  });

  it('keeps different families in separate entries', async () => {
    await write('Inter-Regular.ttf');
    await write('Roboto-Regular.ttf');
    const entries = parseFontsDir(tempDir);
    expect(entries).toHaveLength(2);
    const fams = entries.map((e) => e.family).sort();
    expect(fams).toEqual(['Inter', 'Roboto']);
  });

  it('ignores non .ttf/.otf files', async () => {
    await write('Inter-Regular.ttf');
    await write('README.md');
    await write('cover.png');
    const entries = parseFontsDir(tempDir);
    expect(entries).toHaveLength(1);
    expect(entries[0].family).toBe('Inter');
  });

  it('returns [] for an empty directory', () => {
    expect(parseFontsDir(tempDir)).toEqual([]);
  });

  it('throws on a non-existent directory', () => {
    expect(() => parseFontsDir(path.join(tempDir, 'nope'))).toThrow(
      /could not be read/
    );
  });
});
