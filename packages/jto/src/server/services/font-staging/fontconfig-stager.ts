/**
 * Linux + macOS: use fontconfig to expose staged TTFs to LibreOffice.
 *
 * Writes each resolved font to `<tempDir>/fonts/` and a minimal
 * fontconfig.xml that includes that dir plus the system font config.
 * LibreOffice honors the per-invocation FONTCONFIG_FILE env var.
 *
 * No cleanup work is needed here — the converter removes the whole tempDir
 * in its own finally block.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { ResolvedFont } from '@json-to-office/shared';
import {
  synthesizeFamilyName,
  rewriteFontFamilyName,
} from '@json-to-office/shared';
import type { FontStager, FontStageHandle } from './types';
import { nextStagingId, safeFilenamePart } from './types';

const SYSTEM_FONTS_CONF_CANDIDATES = [
  '/etc/fonts/fonts.conf',
  '/opt/homebrew/etc/fonts/fonts.conf',
  '/usr/local/etc/fonts/fonts.conf',
];

export class FontconfigStager implements FontStager {
  async stage(
    fonts: ResolvedFont[],
    tempDir: string
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
        // Cleanup handled by converter's tempDir rm -rf.
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
