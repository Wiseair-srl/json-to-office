/**
 * Factory entry point for the font staging pipeline used by the
 * LibreOffice-based PDF preview.
 */

import type { FontStager } from './types';
import { NoopFontStager } from './noop-stager';
import { FontconfigStager } from './fontconfig-stager';
import { WindowsFontStager } from './windows-stager';
import { MacOSCoreTextStager } from './macos-stager';

export type { FontStager, FontStageHandle } from './types';

let cached: FontStager | null = null;

export function getFontStager(
  platform: NodeJS.Platform = process.platform
): FontStager {
  if (cached) return cached;
  switch (platform) {
    case 'win32':
      cached = new WindowsFontStager();
      break;
    case 'darwin':
      // LibreOffice-for-macOS uses Core Text for font enumeration and does
      // not honor FONTCONFIG_FILE reliably. Register fonts at the Core Text
      // session scope so the soffice child inherits them.
      cached = new MacOSCoreTextStager();
      break;
    case 'linux':
    case 'freebsd':
    case 'openbsd':
      cached = new FontconfigStager();
      break;
    default:
      cached = new NoopFontStager();
  }
  return cached;
}

export {
  NoopFontStager,
  FontconfigStager,
  WindowsFontStager,
  MacOSCoreTextStager,
};
