/**
 * Linux + macOS: use fontconfig to expose staged TTFs to LibreOffice.
 *
 * Writes each resolved font to `<tempDir>/fonts/` and a minimal
 * fontconfig.xml that includes that dir plus the system font config.
 * LibreOffice honors the per-invocation FONTCONFIG_FILE env var.
 *
 * The caller removes the whole tempDir in its own finally block; `cleanup()`
 * only has to undo the read-only freeze stage() puts on the fonts dir so
 * that recursive rm can actually unlink.
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

const SYSTEM_FONTS_CONF_CANDIDATES = [
  '/etc/fonts/fonts.conf',
  '/opt/homebrew/etc/fonts/fonts.conf',
  '/usr/local/etc/fonts/fonts.conf',
];

export class FontconfigStager implements FontStager {
  async stage(
    fonts: ResolvedFont[],
    tempDir: string,
    // Ignored: fontconfig discovery is driven by FONTCONFIG_FILE, not by the
    // soffice UserInstallation profile.
    _options?: FontStageOptions
  ): Promise<FontStageHandle> {
    const id = nextStagingId();
    const fontsDir = path.join(tempDir, 'fonts');
    await fs.mkdir(fontsDir, { recursive: true });

    let serial = 0;
    for (const r of fonts) {
      if (r.sources.length === 0) continue;
      for (const s of r.sources) {
        serial += 1;
        const suffix = s.italic ? 'i' : 'r';
        // Rewrite `name` table so fontconfig indexes the file under the
        // synthetic sub-family ("Inter Light"), matching the doc's
        // `rFonts`/`fontFace` references after synthesizeFamilyName.
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
        await fs.writeFile(path.join(fontsDir, name), data);
      }
    }

    // Freeze the fonts dir read-only after staging so a misbehaving
    // fontconfig run (or a concurrent soffice spawn) can't corrupt the
    // file contents we just wrote. fc-cache writes its own indexes into
    // `cacheDir` (next step), which stays writable. The whole tree gets
    // rm'd by the converter in finally, so mode matters only during the
    // conversion window.
    await fs.chmod(fontsDir, 0o555).catch(() => {
      // Some filesystems (e.g. certain Windows-mounted shares under WSL)
      // refuse chmod — ignore and proceed. The defensive-in-depth case
      // still wins on native Linux/macOS.
    });
    const includeLines = await this.pickSystemIncludes();
    // Redirect fontconfig's scan cache into tempDir. Without this, fontconfig
    // writes cache entries for `fontsDir` into the user's ~/.cache/fontconfig
    // and leaves them behind after tempDir is rm'd. Per-invocation isolation
    // also prevents two concurrent conversions from racing on the same
    // fontconfig cache directory.
    const cacheDir = path.join(tempDir, 'fc-cache');
    await fs.mkdir(cacheDir, { recursive: true });
    const configPath = path.join(tempDir, 'fontconfig.xml');
    const configXml = [
      '<?xml version="1.0"?>',
      '<!DOCTYPE fontconfig SYSTEM "fonts.dtd">',
      '<fontconfig>',
      `  <dir>${escapeXml(fontsDir)}</dir>`,
      `  <cachedir>${escapeXml(cacheDir)}</cachedir>`,
      ...includeLines,
      '</fontconfig>',
      '',
    ].join('\n');
    await fs.writeFile(configPath, configXml, 'utf8');

    return {
      envOverrides: {
        FONTCONFIG_FILE: configPath,
        XDG_CACHE_HOME: cacheDir,
      },
      cleanup: async () => {
        // Restore write permission before the caller's recursive rm. stage()
        // froze fontsDir to 0o555, and you cannot unlink entries inside a
        // non-writable directory: `fs.rm(tempDir, { recursive: true })` fails
        // with EACCES and leaks the whole temp tree (both callers swallow
        // that error, so it was silent). Removing the files themselves is
        // still the caller's job.
        await fs.chmod(fontsDir, 0o755).catch(() => {});
      },
    };
  }

  private async pickSystemIncludes(): Promise<string[]> {
    for (const candidate of SYSTEM_FONTS_CONF_CANDIDATES) {
      try {
        await fs.access(candidate);
        return [
          `  <include ignore_missing="yes">${escapeXml(candidate)}</include>`,
        ];
      } catch {
        /* try next */
      }
    }
    // Fall back to the conventional path; fontconfig will fail softly.
    return [`  <include ignore_missing="yes">/etc/fonts/fonts.conf</include>`];
  }
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
