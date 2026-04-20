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
      if (!r.willEmbed) continue;
      for (const s of r.sources) {
        serial += 1;
        const suffix = s.italic ? 'i' : 'r';
        const name = `${safeFilenamePart(r.family)}-${s.weight}${suffix}-${id}-${serial}.ttf`;
        await fs.writeFile(path.join(fontsDir, name), s.data);
      }
    }

    const includeLines = await this.pickSystemIncludes();
    // Redirect fontconfig's scan cache into tempDir. Without this, fontconfig
    // writes cache entries for `fontsDir` into the user's ~/.cache/fontconfig
    // and leaves them behind after tempDir is rm'd.
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
