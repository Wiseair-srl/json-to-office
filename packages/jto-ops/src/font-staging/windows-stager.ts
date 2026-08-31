/**
 * Windows: register staged TTFs with GDI via AddFontResourceW so the soffice
 * child process finds them at startup. Forces LibreOffice onto the GDI
 * backend via SAL_DISABLE_SKIA=1 — Skia/DirectWrite doesn't reliably pick
 * up GDI-registered fonts on recent LO builds.
 *
 * Scope, precisely: `AddFontResourceW` adds to the **session** font table, not
 * a private per-process one. That is deliberate and unavoidable here — the
 * private variant (`AddFontResourceExW` with `FR_PRIVATE`) is visible only to
 * the registering process, and the process that has to see these fonts is the
 * `soffice` CHILD. Node stays alive for the full conversion so the fonts
 * persist until cleanup, and GDI releases them on process exit if Node
 * crashes, so nothing leaks past the process.
 *
 * KNOWN LIMITATION — concurrent conversions on one Windows host share that
 * session table. Two conversions staging different bytes under the same
 * synthesized family (say two documents that each embed their own "Inter")
 * register two faces claiming one name, and which one GDI hands to soffice is
 * then order-dependent. Staged FILES never collide — each carries a
 * pid-plus-counter suffix — so this is a resolution ambiguity, not corruption.
 *
 * Not fixed here because the only correct fix is a host-wide lease held from
 * stage() through cleanup(), which serializes every Windows conversion; that
 * is a real throughput cost for a risk the deployed images do not carry (both
 * production containers are Linux/fontconfig, where staging is per-process via
 * FONTCONFIG_FILE and cannot collide). It bites a Windows host running
 * concurrent conversions — worth a lease if that becomes a supported topology.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { ResolvedFont } from '@json-to-office/shared';
import {
  synthesizeFamilyName,
  rewriteFontFamilyName,
} from '@json-to-office/shared';
import type { FontStager, FontStageHandle, FontStageOptions } from './types';
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
    tempDir: string,
    // Ignored: GDI registration is session-wide, not scoped to any one
    // LibreOffice UserInstallation profile, so the retry profiles need no
    // separate seeding the way the macOS Core Text stager's do.
    _options?: FontStageOptions
  ): Promise<FontStageHandle> {
    const id = nextStagingId();
    const fontsDir = path.join(tempDir, 'fonts');
    await fs.mkdir(fontsDir, { recursive: true });

    const stagedPaths: string[] = [];
    let serial = 0;
    for (const r of fonts) {
      if (r.sources.length === 0) continue;
      for (const s of r.sources) {
        serial += 1;
        const suffix = s.italic ? 'i' : 'r';
        // Rewrite the TTF's internal family name so GDI registers the
        // file under the synthetic sub-family the doc references.
        //
        // The unrewritten branch (RIBBI: the run rides bold/italic toggles
        // on the base family) leans on the bytes already declaring
        // `r.family`. That is FontRegistry's `stampResolvedFamily` — do not
        // read the skip as "this file is fine by construction".
        const synth = synthesizeFamilyName(r.family, s.weight, s.italic);
        const data =
          synth.family === r.family
            ? s.data
            : rewriteFontFamilyName(s.data, synth.family);
        const name = `${safeFilenamePart(synth.family)}-${s.weight}${suffix}-${id}-${serial}.ttf`;
        const fullPath = path.join(fontsDir, name);
        await fs.writeFile(fullPath, data);
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
