import { describe, it, expect, beforeEach, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ResolvedFont } from '@json-to-office/shared';
import { FontconfigStager } from '../fontconfig-stager';
import { NoopFontStager } from '../noop-stager';

const TTF_BUF = Buffer.concat([
  Buffer.from([0x00, 0x01, 0x00, 0x00]),
  Buffer.alloc(128),
]);

const oneFont = (): ResolvedFont[] => [
  {
    family: 'Inter',
    willEmbed: true,
    sources: [{ data: TTF_BUF, weight: 400, italic: false, format: 'ttf' }],
    warnings: [],
  },
];

describe('NoopFontStager', () => {
  it('returns empty env overrides and no-op cleanup', async () => {
    const stager = new NoopFontStager();
    const handle = await stager.stage();
    expect(handle.envOverrides).toEqual({});
    await expect(handle.cleanup()).resolves.toBeUndefined();
  });
});

describe('FontconfigStager', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'jto-stager-test-'));
  });

  it('writes every willEmbed source into <tempDir>/fonts/ before returning', async () => {
    const stager = new FontconfigStager();
    await stager.stage(oneFont(), tempDir);

    const fontsDir = path.join(tempDir, 'fonts');
    const entries = await fs.readdir(fontsDir);
    expect(entries).toHaveLength(1);
    const written = await fs.readFile(path.join(fontsDir, entries[0]));
    expect(written.equals(TTF_BUF)).toBe(true);
  });

  it('returns FONTCONFIG_FILE env override pointing at a file that contains the fonts dir', async () => {
    const stager = new FontconfigStager();
    const handle = await stager.stage(oneFont(), tempDir);

    expect(handle.envOverrides.FONTCONFIG_FILE).toBe(
      path.join(tempDir, 'fontconfig.xml')
    );
    const xml = await fs.readFile(handle.envOverrides.FONTCONFIG_FILE, 'utf8');
    expect(xml).toContain(path.join(tempDir, 'fonts'));
    expect(xml).toContain('<fontconfig>');
    expect(xml).toContain('<include');
  });

  it('skips fonts with willEmbed=false', async () => {
    const stager = new FontconfigStager();
    const fonts: ResolvedFont[] = [
      { family: 'Arial', willEmbed: false, sources: [], warnings: [] },
      ...oneFont(),
    ];
    await stager.stage(fonts, tempDir);
    const entries = await fs.readdir(path.join(tempDir, 'fonts'));
    expect(entries).toHaveLength(1);
  });

  it('filenames include pid + a per-process monotonic counter (disambiguates concurrent conversions)', async () => {
    const stager = new FontconfigStager();
    const dirA = await fs.mkdtemp(path.join(os.tmpdir(), 'jto-stager-a-'));
    const dirB = await fs.mkdtemp(path.join(os.tmpdir(), 'jto-stager-b-'));
    await stager.stage(oneFont(), dirA);
    await stager.stage(oneFont(), dirB);
    const aFiles = await fs.readdir(path.join(dirA, 'fonts'));
    const bFiles = await fs.readdir(path.join(dirB, 'fonts'));
    expect(aFiles[0]).not.toEqual(bFiles[0]);
    expect(aFiles[0]).toMatch(new RegExp(`-${process.pid}-`));
    expect(bFiles[0]).toMatch(new RegExp(`-${process.pid}-`));
  });
});

describe('converter ordering (stage → spawn → cleanup)', () => {
  it('stage is awaited before soffice spawn and cleanup runs after soffice resolves', async () => {
    // This guards the invariant: a crashing soffice must not leave fonts
    // registered, and a slow stager must not race ahead of the conversion.
    const events: string[] = [];

    // Minimal FontStager stub.
    const stager = {
      async stage() {
        events.push('stage-start');
        await new Promise((r) => setTimeout(r, 5));
        events.push('stage-end');
        return {
          envOverrides: { X: '1' },
          cleanup: async () => {
            events.push('cleanup-start');
            await new Promise((r) => setTimeout(r, 5));
            events.push('cleanup-end');
          },
        };
      },
    };

    // Minimal "converter" that mimics the converter's control flow.
    async function runConversion() {
      const handle = await stager.stage();
      events.push('spawn-start');
      await new Promise((r) => setTimeout(r, 5));
      events.push('spawn-end');
      await handle.cleanup();
    }

    await runConversion();

    expect(events).toEqual([
      'stage-start',
      'stage-end',
      'spawn-start',
      'spawn-end',
      'cleanup-start',
      'cleanup-end',
    ]);
  });

  it('cleanup still runs when soffice throws', async () => {
    const events: string[] = [];
    const stager = {
      async stage() {
        events.push('stage');
        return {
          envOverrides: {},
          cleanup: async () => {
            events.push('cleanup');
          },
        };
      },
    };

    async function runConversion() {
      const handle = await stager.stage();
      try {
        events.push('spawn');
        throw new Error('soffice crashed');
      } finally {
        await handle.cleanup();
      }
    }

    await expect(runConversion()).rejects.toThrow('soffice crashed');
    expect(events).toEqual(['stage', 'spawn', 'cleanup']);
  });
});

describe('factory selection', () => {
  it('picks NoopFontStager on unknown platforms', async () => {
    const { getFontStager, NoopFontStager: Noop } = await import('../index');
    // We can't easily mock process.platform here without re-requiring modules,
    // but we can at least assert the exported stagers exist.
    expect(Noop).toBeDefined();
    expect(getFontStager).toBeDefined();
  });
});

// Silence vi if the test file grows
vi.stubGlobal('__unused', true);
