/**
 * macOS: register staged TTFs with Core Text in Session scope so the soffice
 * child process inherits them. LibreOffice-for-macOS uses Core Text for font
 * enumeration and rendering and does not meaningfully honor FONTCONFIG_FILE —
 * so the Linux fontconfig trick doesn't transfer here.
 *
 * Session-scoped registration lives for the current user login session.
 * Node stays alive for the full conversion, so cleanup runs predictably;
 * if Node crashes, the fonts remain registered until the session ends (at
 * logout) — acceptable for a dev preview tool.
 *
 * Also sets SAL_DISABLE_SKIA=1 to force LO's Core Graphics backend, which
 * guarantees Core Text is used for font lookup. Skia on macOS can take its
 * own path that sometimes misses freshly-registered fonts.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { ResolvedFont } from '@json-to-office/shared';
import type { FontStager, FontStageHandle } from './types';
import { nextStagingId, safeFilenamePart } from './types';

const CF_FRAMEWORK =
  '/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation';
const CT_FRAMEWORK = '/System/Library/Frameworks/CoreText.framework/CoreText';

/** kCTFontManagerScopeSession — fonts visible to all processes in the login session. */
const SCOPE_SESSION = 3;

type KoffiLib = {
  func: (sig: string) => (...args: unknown[]) => unknown;
};
type KoffiModule = {
  load: (libName: string) => KoffiLib;
  alloc: (type: string, len: number) => Buffer;
};

interface CtBindings {
  /** CFURLCreateFromFileSystemRepresentation(NULL, path, len, false) -> CFURLRef */
  createUrl: (pathBytes: Buffer, length: number) => unknown;
  /** CFRelease(ref) */
  release: (ref: unknown) => void;
  /** CTFontManagerRegisterFontsForURL(url, scope, NULL) -> bool */
  register: (url: unknown) => boolean;
  /** CTFontManagerUnregisterFontsForURL(url, scope, NULL) -> bool */
  unregister: (url: unknown) => boolean;
}

let cachedBindings: CtBindings | null = null;
let bindingsFailed = false;

async function getCtBindings(): Promise<CtBindings | null> {
  if (cachedBindings) return cachedBindings;
  if (bindingsFailed) return null;
  try {
    const koffi = (await import('koffi')) as unknown as {
      default?: KoffiModule;
    } & KoffiModule;
    const mod = koffi.default ?? koffi;
    const cf = mod.load(CF_FRAMEWORK);
    const ct = mod.load(CT_FRAMEWORK);

    const cfUrlCreate = cf.func(
      'void *CFURLCreateFromFileSystemRepresentation(void *, const uint8_t *, long, bool)'
    ) as (
      allocator: null,
      bytes: Buffer,
      length: number,
      isDir: boolean
    ) => unknown;
    const cfRelease = cf.func('void CFRelease(void *)') as (
      ref: unknown
    ) => void;
    const ctRegister = ct.func(
      'bool CTFontManagerRegisterFontsForURL(void *, uint32_t, void *)'
    ) as (url: unknown, scope: number, err: null) => boolean;
    const ctUnregister = ct.func(
      'bool CTFontManagerUnregisterFontsForURL(void *, uint32_t, void *)'
    ) as (url: unknown, scope: number, err: null) => boolean;

    cachedBindings = {
      createUrl: (pathBytes, length) =>
        cfUrlCreate(null, pathBytes, length, false),
      release: (ref) => cfRelease(ref),
      register: (url) => ctRegister(url, SCOPE_SESSION, null),
      unregister: (url) => ctUnregister(url, SCOPE_SESSION, null),
    };
    return cachedBindings;
  } catch (err) {
    bindingsFailed = true;
    // eslint-disable-next-line no-console
    console.warn(
      `[font-staging] Core Text bindings unavailable (${(err as Error).message}); ` +
        `LibreOffice preview will render with system fallback fonts.`
    );
    return null;
  }
}

interface StagedFont {
  cfUrl: unknown;
  /** Kept so we can release the CFURL even if unregister fails. */
  absolutePath: string;
}

export class MacOSCoreTextStager implements FontStager {
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
        const full = path.join(fontsDir, name);
        await fs.writeFile(full, s.data);
        stagedPaths.push(full);
      }
    }

    if (stagedPaths.length === 0) {
      return { envOverrides: {}, cleanup: async () => {} };
    }

    const bindings = await getCtBindings();
    if (!bindings) {
      // koffi failed to load — fonts are on disk but Core Text can't register
      // them. LibreOffice will fall back to system fonts. Preview still works.
      return {
        envOverrides: { SAL_DISABLE_SKIA: '1' },
        cleanup: async () => {},
      };
    }
    const registered: StagedFont[] = [];
    for (const p of stagedPaths) {
      const bytes = Buffer.from(p, 'utf8');
      const url = bindings.createUrl(bytes, bytes.byteLength);
      if (!url) {
        // eslint-disable-next-line no-console
        console.warn(
          `[font-staging] CFURLCreateFromFileSystemRepresentation failed for ${p}`
        );
        continue;
      }
      const ok = bindings.register(url);
      if (ok) {
        registered.push({ cfUrl: url, absolutePath: p });
      } else {
        // Registration failed (duplicate PS name or malformed TTF). Log so the
        // silent "font missing in preview" case is diagnosable, then release
        // the URL so we don't leak CF memory.
        // eslint-disable-next-line no-console
        console.warn(
          `[font-staging] CTFontManagerRegisterFontsForURL returned false for ${p}`
        );
        bindings.release(url);
      }
    }

    let cleaned = false;
    return {
      envOverrides: {
        SAL_DISABLE_SKIA: '1',
      },
      cleanup: async () => {
        if (cleaned) return;
        cleaned = true;
        for (const f of registered) {
          try {
            bindings.unregister(f.cfUrl);
          } catch {
            /* ignore — CT will drop refs on process exit */
          }
          try {
            bindings.release(f.cfUrl);
          } catch {
            /* ignore */
          }
        }
      },
    };
  }
}
