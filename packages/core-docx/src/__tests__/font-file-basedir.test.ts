/**
 * A relative `kind: "file"` font source resolves against the render's
 * `baseDir`, as a relative image path does.
 *
 * The registry used to read `fonts.baseDir` only, so every caller that set the
 * render's `baseDir` and not the fonts' (the MCP preview, the gallery
 * thumbnails, `jto_generate`) looked for the files in `process.cwd()`: the font
 * went unresolved, the preview drew a fallback and `embed` wrote nothing.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import type { GenerationWarning } from '@json-to-office/shared';
import { generateBufferFromJson } from '../core/generator';

const FONTS = path.resolve(__dirname, '../styles/fonts/life-sans');

const document = {
  name: 'docx' as const,
  props: {
    theme: 'minimal',
    fontRegistry: [
      {
        id: 'Life Sans',
        family: 'Life Sans',
        sources: [
          { kind: 'file', path: 'fonts/LifeSans-Regular.ttf', weight: 400 },
          { kind: 'file', path: 'fonts/LifeSans-Bold.ttf', weight: 700 },
        ],
      },
    ],
  },
  children: [
    {
      name: 'paragraph',
      props: { text: 'Body and **bold**.', font: { family: 'Life Sans' } },
    },
  ],
};

describe('kind:"file" font sources and the render baseDir', () => {
  let baseDir: string;

  beforeAll(() => {
    baseDir = mkdtempSync(path.join(tmpdir(), 'jto-docx-font-basedir-'));
    cpSync(
      path.join(FONTS, 'LifeSans-Regular.ttf'),
      path.join(baseDir, 'fonts', 'LifeSans-Regular.ttf'),
      { recursive: true }
    );
    cpSync(
      path.join(FONTS, 'LifeSans-Bold.ttf'),
      path.join(baseDir, 'fonts', 'LifeSans-Bold.ttf')
    );
  });
  afterAll(() => rmSync(baseDir, { recursive: true, force: true }));

  it('resolves against baseDir when fonts.baseDir is not set', async () => {
    const warnings: GenerationWarning[] = [];
    const buffer = await generateBufferFromJson(document as never, {
      baseDir,
      fonts: { mode: 'embed', googleFonts: { enabled: false } },
      warnings,
    });
    const zip = await JSZip.loadAsync(buffer);
    expect(
      Object.keys(zip.files).filter((f) => /^word\/fonts\/.+\.odttf$/.test(f))
    ).toHaveLength(2);
    expect(
      warnings.filter((w) => w.context?.code === 'FONT_UNRESOLVED')
    ).toEqual([]);
  });

  it('lets an explicit fonts.baseDir win', async () => {
    const warnings: GenerationWarning[] = [];
    await generateBufferFromJson(document as never, {
      baseDir,
      fonts: {
        mode: 'embed',
        baseDir: path.join(baseDir, 'elsewhere'),
        googleFonts: { enabled: false },
      },
      warnings,
    });
    expect(warnings.some((w) => w.context?.code === 'FONT_UNRESOLVED')).toBe(
      true
    );
  });
});
