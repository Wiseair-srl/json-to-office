/**
 * The cache-key contract, input by input.
 *
 * Every field in the material below can change the pixels, so every field has
 * a test that changes it and expects a different key. The inverse matters just
 * as much: a document whose keys were serialized in a different order is the
 * same document, and an unchanged document must not re-render.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { ResolvedFont } from '@json-to-office/shared';

import {
  canonicalJson,
  derivePreviewCacheKeys,
  digestAssets,
  digestFonts,
  digestThemeFile,
  type PreviewCacheMaterial,
} from '../preview/cache-key.js';

const document = {
  name: 'docx',
  props: { theme: 'minimal' },
  children: [{ type: 'paragraph', text: 'Hello' }],
};

const base: PreviewCacheMaterial = {
  format: 'docx',
  document,
  render: {},
  themeDigest: 'none',
  assetsDigest: 'none',
  fontsDigest: 'none',
  dpi: 150,
  pageSelection: '1-',
  converters: { libreoffice: 'LO 26|1|2', pdftoppm: 'poppler 24|3|4' },
};

function keys(overrides: Partial<PreviewCacheMaterial> = {}) {
  return derivePreviewCacheKeys({ ...base, ...overrides });
}

describe('canonicalJson', () => {
  it('is insensitive to key order at every depth', () => {
    expect(canonicalJson({ a: 1, b: { c: 2, d: 3 } })).toBe(
      canonicalJson({ b: { d: 3, c: 2 }, a: 1 })
    );
  });

  it('keeps array order, where order is meaning', () => {
    expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]));
  });

  it('drops undefined properties the way JSON does', () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe(canonicalJson({ a: 1 }));
  });
});

describe('derivePreviewCacheKeys', () => {
  it('is stable for identical material', () => {
    expect(keys().runKey).toBe(keys().runKey);
    expect(keys().documentKey).toBe(keys().documentKey);
  });

  it('ignores the order the document was serialized in', () => {
    const reordered = {
      children: document.children,
      props: document.props,
      name: document.name,
    };
    expect(keys({ document: reordered }).runKey).toBe(keys().runKey);
  });

  it.each<[string, Partial<PreviewCacheMaterial>]>([
    ['a changed document', { document: { ...document, name: 'other' } }],
    ['a changed format', { format: 'pptx' }],
    ['a changed DPI', { dpi: 300 }],
    ['a changed renderer', { render: { renderer: 'docxjs-next' } }],
    ['a changed theme', { render: { theme: 'corporate' } }],
    ['a changed baseDir', { render: { baseDir: '/elsewhere' } }],
    ['a changed theme file', { themeDigest: 'abc' }],
    ['changed assets', { assetsDigest: 'abc' }],
    ['changed fonts', { fontsDigest: 'abc' }],
    ['a LibreOffice upgrade', { converters: { libreoffice: 'LO 27|1|2' } }],
  ])('misses on %s', (_label, overrides) => {
    expect(keys(overrides).documentKey).not.toBe(keys().documentKey);
    expect(keys(overrides).runKey).not.toBe(keys().runKey);
  });

  it('separates the run identity from the page identity', () => {
    const wide = keys({ pageSelection: '1-3' });
    const narrow = keys({ pageSelection: '2-5' });

    // The selection is part of the request's identity …
    expect(wide.runKey).not.toBe(narrow.runKey);
    // … but not of a page's, so overlapping requests share rendered pages.
    expect(wide.documentKey).toBe(narrow.documentKey);
    expect(wide.pageKey(2)).toBe(narrow.pageKey(2));
    expect(wide.pageKey(2)).not.toBe(wide.pageKey(3));
  });

  it('gives a changed DPI different pages, not just a different run', () => {
    expect(keys({ dpi: 300 }).pageKey(1)).not.toBe(keys().pageKey(1));
  });
});

describe('digestFonts', () => {
  const face = (family: string, data: string, weight = 400): ResolvedFont => ({
    family,
    sources: [
      { data: Buffer.from(data), weight, italic: false, format: 'ttf' },
    ],
    warnings: [],
  });

  it('reports nothing for a document with no resolved faces', () => {
    expect(digestFonts([])).toBe('none');
  });

  it('is order-insensitive', () => {
    expect(digestFonts([face('Inter', 'a'), face('Lora', 'b')])).toBe(
      digestFonts([face('Lora', 'b'), face('Inter', 'a')])
    );
  });

  it('changes when the bytes behind a family change', () => {
    expect(digestFonts([face('Inter', 'a')])).not.toBe(
      digestFonts([face('Inter', 'b')])
    );
  });

  it('changes when a weight changes', () => {
    expect(digestFonts([face('Inter', 'a', 400)])).not.toBe(
      digestFonts([face('Inter', 'a', 700)])
    );
  });
});

describe('digestAssets and digestThemeFile', () => {
  let scratch: string;

  beforeEach(async () => {
    scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'jto-mcp-assets-'));
  });
  afterEach(async () => {
    await fs.rm(scratch, { recursive: true, force: true });
  });

  it('reports nothing when a document references no local files', async () => {
    await expect(digestAssets({ text: 'hello' })).resolves.toBe('none');
  });

  it('ignores data and http references, which carry their own identity', async () => {
    await expect(
      digestAssets({
        a: 'data:image/png;base64,AAAA',
        b: 'https://example.com/logo.png',
      })
    ).resolves.toBe('none');
  });

  it('changes when a referenced file changes on disk', async () => {
    const asset = path.join(scratch, 'logo.png');
    await fs.writeFile(asset, 'first');
    const before = await digestAssets({ src: 'logo.png' }, scratch);
    expect(before).not.toBe('none');

    await fs.writeFile(asset, 'second and longer');
    const after = await digestAssets({ src: 'logo.png' }, scratch);
    expect(after).not.toBe(before);
  });

  it('finds references at any depth', async () => {
    await fs.writeFile(path.join(scratch, 'a.png'), 'x');
    const nested = await digestAssets(
      { children: [{ image: { src: 'a.png' } }] },
      scratch
    );
    expect(nested).not.toBe('none');
  });

  it('survives a missing file rather than throwing', async () => {
    await expect(digestAssets({ src: 'gone.png' }, scratch)).resolves.toBe(
      'none'
    );
  });

  it('identifies a theme file, and says so when it is absent', async () => {
    const theme = path.join(scratch, 'theme.json');
    await fs.writeFile(theme, '{"name":"x"}');
    const present = await digestThemeFile(theme);
    expect(present).toContain('theme.json');

    await expect(digestThemeFile(undefined)).resolves.toBe('none');
    await expect(
      digestThemeFile(path.join(scratch, 'nope.json'))
    ).resolves.toContain('missing');
  });
});
