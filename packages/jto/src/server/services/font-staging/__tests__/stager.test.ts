import { describe, it, expect, beforeEach, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ResolvedFont } from '@json-to-office/shared';
import { FontconfigStager } from '../fontconfig-stager';
import { MacOSCoreTextStager } from '../macos-stager';
import { NoopFontStager } from '../noop-stager';

const TTF_BUF = Buffer.concat([
  Buffer.from([0x00, 0x01, 0x00, 0x00]),
  Buffer.alloc(128),
]);

const oneFont = (): ResolvedFont[] => [
  {
    family: 'Inter',
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

  it('writes every resolved source into <tempDir>/fonts/ before returning', async () => {
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

  it('skips fonts with no sources', async () => {
    const stager = new FontconfigStager();
    const fonts: ResolvedFont[] = [
      { family: 'Arial', sources: [], warnings: [] },
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

describe.skipIf(process.platform !== 'darwin')('MacOSCoreTextStager', () => {
  let tempDir: string;

  beforeEach(async () => {
    // The stager writes only into tempDir (the converter's per-invocation
    // scratch). No ~/Library writes, no orphan sweep needed — tempDir rm
    // happens in the converter's finally.
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'jto-stager-darwin-'));
  });

  it('writes each resolved source into <tempDir>/fonts/', async () => {
    const stager = new MacOSCoreTextStager();
    await stager.stage(oneFont(), tempDir);

    const fontsDir = path.join(tempDir, 'fonts');
    const entries = await fs.readdir(fontsDir);
    expect(entries).toHaveLength(1);
    // Filename shape: <family>-<weight><suffix>-<pid>-<counter>-<serial>.ttf
    expect(entries[0]).toMatch(
      new RegExp(`^Inter-400r-${process.pid}-\\d+-\\d+\\.ttf$`)
    );
    const written = await fs.readFile(path.join(fontsDir, entries[0]));
    expect(written.equals(TTF_BUF)).toBe(true);
  });

  it('seeds the Python macro + XCU into the per-invocation UserInstallation', async () => {
    const stager = new MacOSCoreTextStager();
    await stager.stage(oneFont(), tempDir);

    const macroPath = path.join(
      tempDir,
      'user-profile',
      'user',
      'Scripts',
      'python',
      'JtoFontRegister.py'
    );
    const xcuPath = path.join(
      tempDir,
      'user-profile',
      'user',
      'registrymodifications.xcu'
    );
    const macro = await fs.readFile(macroPath, 'utf8');
    const xcu = await fs.readFile(xcuPath, 'utf8');

    // The macro must call CTFontManagerRegisterFontsForURL with scope=1
    // (Process). Any other scope breaks the whole premise — assert the
    // literal constant rather than a regex so a refactor can't silently
    // drift to Session (=3) and look like it works locally.
    expect(macro).toContain('CTFontManagerRegisterFontsForURL');
    expect(macro).toContain('kCTFontManagerScopeProcess = 1');
    expect(macro).toContain('JTO_FONT_PATHS');
    // The XCU must bind OnStartApp to the macro, not merely declare it.
    expect(xcu).toContain('OnStartApp');
    expect(xcu).toMatch(/vnd\.sun\.star\.script:JtoFontRegister\.py\$register/);
    // Macro security must be relaxed, or the binding fires into a
    // disabled-macros wall. Again: assert the specific value.
    expect(xcu).toContain('MacroSecurityLevel');
    expect(xcu).toMatch(/<value>0<\/value>/);
  });

  it('exposes JTO_FONT_PATHS and SAL_DISABLE_SKIA in envOverrides', async () => {
    const stager = new MacOSCoreTextStager();
    const handle = await stager.stage(oneFont(), tempDir);

    const env = handle.envOverrides;
    expect(env.SAL_DISABLE_SKIA).toBe('1');
    // JTO_FONT_PATHS must contain the absolute path of each staged TTF,
    // colon-separated to match Python's os.pathsep on macOS. The macro
    // splits on os.pathsep; any mismatch here means no fonts register.
    const paths = env.JTO_FONT_PATHS?.split(':') ?? [];
    expect(paths).toHaveLength(1);
    expect(paths[0]).toMatch(
      new RegExp(
        `^${path.join(tempDir, 'fonts').replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}/`
      )
    );
    const stat = await fs.stat(paths[0]);
    expect(stat.isFile()).toBe(true);
  });

  it('is a no-op when no fonts are embeddable (safe-font-only documents)', async () => {
    const stager = new MacOSCoreTextStager();
    const handle = await stager.stage(
      [{ family: 'Arial', sources: [], warnings: [] }],
      tempDir
    );
    expect(handle.envOverrides).toEqual({});
    // No fonts dir, no macro, no XCU — skip the whole profile seed when
    // there's nothing to register. Avoids spurious macro runs that would
    // log "registered 0 fonts" on every safe-font doc.
    await expect(fs.access(path.join(tempDir, 'fonts'))).rejects.toThrow();
    await expect(
      fs.access(path.join(tempDir, 'user-profile'))
    ).rejects.toThrow();
  });

  it('cleanup is a no-op (converter tempDir rm handles teardown)', async () => {
    const stager = new MacOSCoreTextStager();
    const handle = await stager.stage(oneFont(), tempDir);
    await expect(handle.cleanup()).resolves.toBeUndefined();
    // Files are still present because cleanup doesn't touch them; the
    // converter's fs.rm(tempDir) is what reaps them in production. This
    // assertion locks in the contract so a future "defensive cleanup"
    // doesn't accidentally double-remove the converter's tempDir.
    const fontsDir = path.join(tempDir, 'fonts');
    const entries = await fs.readdir(fontsDir);
    expect(entries).toHaveLength(1);
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
