/**
 * Relative image paths resolve against `options.baseDir` — the document's own
 * directory — instead of `process.cwd()` (#142). Paths are rewritten eagerly
 * at render time because pptxgenjs reads them later, during write().
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import JSZip from 'jszip';
import { generateBufferFromJson } from '../core/generator';
import { createPresentationGenerator } from '../plugin/createPresentationGenerator';

// Minimal 1x1 transparent PNG
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
);

let docDir: string;

beforeAll(() => {
  docDir = mkdtempSync(join(tmpdir(), 'jto-basedir-pptx-'));
  mkdirSync(join(docDir, 'media'));
  writeFileSync(join(docDir, 'media', 'pixel.png'), PNG_1X1);
});

afterAll(() => {
  rmSync(docDir, { recursive: true, force: true });
});

const doc = {
  name: 'pptx',
  props: {},
  children: [
    {
      name: 'slide',
      props: {},
      children: [
        {
          name: 'image',
          props: { path: 'media/pixel.png', x: 1, y: 1, w: 2, h: 2 },
        },
      ],
    },
  ],
};

async function hasEmbeddedImage(buf: Buffer): Promise<boolean> {
  const zip = await JSZip.loadAsync(buf);
  return Object.keys(zip.files).some((name) => name.startsWith('ppt/media/'));
}

describe('baseDir image resolution (#142)', () => {
  it('resolves a relative image path against options.baseDir', async () => {
    const buf = await generateBufferFromJson(structuredClone(doc) as never, {
      baseDir: docDir,
    });
    expect(await hasEmbeddedImage(buf)).toBe(true);
  });

  it('resolves via the plugin builder constructor baseDir', async () => {
    const result = await createPresentationGenerator({
      baseDir: docDir,
    }).generateBuffer(structuredClone(doc) as never);
    expect(await hasEmbeddedImage(result.buffer)).toBe(true);
  });

  it('per-call baseDir overrides the constructor', async () => {
    const result = await createPresentationGenerator({
      baseDir: '/nonexistent-base',
    }).generateBuffer(structuredClone(doc) as never, { baseDir: docDir });
    expect(await hasEmbeddedImage(result.buffer)).toBe(true);
  });
});
