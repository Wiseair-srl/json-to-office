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

const cached = new Map<NodeJS.Platform, FontStager>();

export function getFontStager(
  platform: NodeJS.Platform = process.platform
): FontStager {
  const hit = cached.get(platform);
  if (hit) return hit;
  let stager: FontStager;
  switch (platform) {
    case 'win32':
      stager = new WindowsFontStager();
      break;
    case 'darwin':
      // LibreOffice-for-macOS uses Core Text for font enumeration and does
      // not honor FONTCONFIG_FILE reliably. Register fonts at the Core Text
      // session scope so the soffice child inherits them.
      stager = new MacOSCoreTextStager();
      break;
    case 'linux':
    case 'freebsd':
    case 'openbsd':
      stager = new FontconfigStager();
      break;
    default:
      stager = new NoopFontStager();
  }
  cached.set(platform, stager);
  return stager;
}

export {
  NoopFontStager,
  FontconfigStager,
  WindowsFontStager,
  MacOSCoreTextStager,
};
