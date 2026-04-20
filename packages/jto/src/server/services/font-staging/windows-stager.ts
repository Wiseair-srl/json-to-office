/**
 * Windows: register staged TTFs with GDI via AddFontResourceW so the soffice
 * child process finds them at startup. Forces LibreOffice onto the GDI
 * backend via SAL_DISABLE_SKIA=1 — Skia/DirectWrite doesn't reliably pick
 * up GDI-registered fonts on recent LO builds.
 *
 * Registration is process-scoped: Node stays alive for the full conversion,
 * so the fonts persist until cleanup. If Node crashes, GDI releases them on
 * process exit — no logout-scope leaks.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { ResolvedFont } from '@json-to-office/shared';
import type { FontStager, FontStageHandle } from './types';
import { nextStagingId, safeFilenamePart } from './types';

type KoffiLib = {
  func: (sig: string) => (...args: unknown[]) => number | boolean;
};
type KoffiModule = {
  load: (libName: string) => KoffiLib;
};

// Lazy-load koffi so Linux/macOS don't incur the FFI init cost.
let cachedBindings: {
  addFont: (pathW: string) => number;
  removeFont: (pathW: string) => boolean;
} | null = null;

async function getGdiBindings() {
  if (cachedBindings) return cachedBindings;
  const koffi = (await import('koffi')) as unknown as {
    default?: KoffiModule;
  } & KoffiModule;
  const mod = koffi.default ?? koffi;
  const gdi32 = mod.load('gdi32.dll');
  cachedBindings = {
    addFont: gdi32.func('int __stdcall AddFontResourceW(str16)') as (
      path: string
    ) => number,
    removeFont: gdi32.func('bool __stdcall RemoveFontResourceW(str16)') as (
      path: string
    ) => boolean,
  };
  return cachedBindings;
}

export class WindowsFontStager implements FontStager {
  async stage(
    fonts: ResolvedFont[],
    tempDir: string
  ): Promise<FontStageHandle> {
    const id = nextStagingId();
    const fontsDir = path.join(tempDir, 'fonts');
    await fs.mkdir(fontsDir, { recursive: true });

    const stagedPaths: string[] = [];
    let serial = 0;
    for (const r of fonts) {
      if (!r.willEmbed) continue;
      for (const s of r.sources) {
        serial += 1;
        const suffix = s.italic ? 'i' : 'r';
        const name = `${safeFilenamePart(r.family)}-${s.weight}${suffix}-${id}-${serial}.ttf`;
        const fullPath = path.join(fontsDir, name);
        await fs.writeFile(fullPath, s.data);
        stagedPaths.push(fullPath);
      }
    }

    if (stagedPaths.length === 0) {
      return { envOverrides: {}, cleanup: async () => {} };
    }

    const { addFont, removeFont } = await getGdiBindings();
    const registered: string[] = [];
    for (const p of stagedPaths) {
      const added = addFont(p);
      if (added > 0) registered.push(p);
    }

    let cleaned = false;
    return {
      envOverrides: {
        // Force GDI backend so the freshly-registered fonts are visible.
        // Skia on Windows uses DirectWrite which does not reliably see
        // fonts added via AddFontResourceW.
        SAL_DISABLE_SKIA: '1',
      },
      cleanup: async () => {
        if (cleaned) return;
        cleaned = true;
        for (const p of registered) {
          try {
            removeFont(p);
          } catch {
            // Swallow — GDI will drop it on process exit anyway.
          }
        }
      },
    };
  }
}
