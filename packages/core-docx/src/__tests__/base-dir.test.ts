/**
 * Relative image paths resolve against `options.baseDir` — the document's own
 * directory — instead of `process.cwd()` (#142). Omitting baseDir keeps the
 * legacy cwd-relative behavior.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import JSZip from 'jszip';
import { generateBufferFromJson } from '../core/generator';
import { createDocumentGenerator } from '../plugin/createDocumentGenerator';
import { resolveFromBaseDir, runWithBaseDir } from '../utils/generationContext';

// Minimal 1x1 transparent PNG
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
);

let docDir: string;

beforeAll(() => {
  docDir = mkdtempSync(join(tmpdir(), 'jto-basedir-'));
  mkdirSync(join(docDir, 'media'));
  writeFileSync(join(docDir, 'media', 'pixel.png'), PNG_1X1);
});

afterAll(() => {
  rmSync(docDir, { recursive: true, force: true });
});

const doc = {
  name: 'docx',
  props: { theme: 'minimal' },
  children: [
    {
      name: 'image',
      props: { path: 'media/pixel.png', width: 50, height: 50 },
    },
  ],
};

async function hasEmbeddedImage(buf: Buffer): Promise<boolean> {
  const zip = await JSZip.loadAsync(buf);
  return Object.keys(zip.files).some((name) => name.startsWith('word/media/'));
}

describe('baseDir image resolution (#142)', () => {
  it('resolves a relative image path against options.baseDir', async () => {
    // cwd is the package root, where media/pixel.png does not exist —
    // resolution must come from baseDir alone.
    const buf = await generateBufferFromJson(structuredClone(doc) as never, {
      baseDir: docDir,
    });
    expect(await hasEmbeddedImage(buf)).toBe(true);
  });

  it('keeps cwd-relative resolution when no baseDir is set', () => {
    // Outside a generation scope the path passes through untouched, so
    // downstream fs calls resolve it against cwd — the legacy behavior.
    expect(resolveFromBaseDir('media/pixel.png')).toBe('media/pixel.png');
    const scoped = runWithBaseDir(docDir, () =>
      resolveFromBaseDir('media/pixel.png')
    );
    expect(scoped).toBe(join(docDir, 'media', 'pixel.png'));
    const absolute = runWithBaseDir(docDir, () =>
      resolveFromBaseDir('/etc/hosts')
    );
    expect(absolute).toBe('/etc/hosts');
  });

  it('resolves via the plugin builder constructor baseDir', async () => {
    const result = await createDocumentGenerator({
      baseDir: docDir,
    }).generateBuffer(structuredClone(doc) as never);
    expect(await hasEmbeddedImage(result.buffer)).toBe(true);
  });

  it('per-call baseDir overrides the constructor', async () => {
    const result = await createDocumentGenerator({
      baseDir: '/nonexistent-base',
    }).generateBuffer(structuredClone(doc) as never, { baseDir: docDir });
    expect(await hasEmbeddedImage(result.buffer)).toBe(true);
  });

  it('leaves absolute paths untouched under a baseDir', async () => {
    const absDoc = {
      ...doc,
      children: [
        {
          name: 'image',
          props: {
            path: join(docDir, 'media', 'pixel.png'),
            width: 50,
            height: 50,
          },
        },
      ],
    };
    const buf = await generateBufferFromJson(structuredClone(absDoc) as never, {
      baseDir: '/nonexistent-base',
    });
    expect(await hasEmbeddedImage(buf)).toBe(true);
  });
});
