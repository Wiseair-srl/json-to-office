/**
 * `ResolvedFont[]` ⇄ `RasterizeFontFace[]` — the one encoder/decoder pair for
 * shipping font bytes to the pptx rasterizer.
 *
 * The docx side encodes (core-docx, from `resolveDocumentFonts`) and the
 * rasterizer side decodes (jto-cli, before handing the faces to a
 * `FontStager`). Keeping both halves here means the two cannot drift on
 * base64 handling or on the family-name convention.
 *
 * FAMILY NAMES STAY UNSYNTHESIZED. The wire carries the catalog family
 * ("Inter"); the stager applies `synthesizeFamilyName` +
 * `rewriteFontFamilyName` to produce the sub-family the presentation
 * actually references ("Inter Light"). Encoding a pre-synthesized name here
 * would make the stager apply the suffix twice.
 *
 * Buffer-dependent → Node-only. Exported from `@json-to-office/shared/fonts/node`.
 */

import type { ResolvedFont, ResolvedFontSource } from './types';
import type { RasterizeFontFace } from '../types/services';
import type { GenerationWarning } from '../types/warnings';

/**
 * Formats the rasterizer's native stagers can actually register.
 *
 * All three stagers (fontconfig, macOS Core Text, Windows GDI) write every
 * staged source as a `.ttf` and register it as a raw sfnt, and they rename
 * the face through `rewriteFontFamilyName`, which returns the buffer
 * UNCHANGED for anything without an sfnt header. So a WOFF/WOFF2 (or EOT, or
 * PostScript) source is staged as bytes no font system parses, under the
 * catalog family rather than the synthesized sub-family the presentation
 * references — it renders as fallback text, silently.
 *
 * Shipping those bytes anyway costs wire size, disk writes, and a distinct
 * rasterizer cache key for a render that is identical to the fontless one.
 * An allowlist (rather than a WOFF denylist) keeps any format added to
 * `ResolvedFontSource['format']` later excluded until a stager can handle it.
 */
const STAGEABLE_FORMATS = new Set<ResolvedFontSource['format']>(['ttf', 'otf']);

/**
 * Flatten resolved fonts into the serializable wire faces (one face per
 * source variant). Entries with no sources — safe-only fonts, which the
 * renderer resolves against system faces — carry no bytes and are skipped,
 * as are sources in a format no stager can register.
 *
 * @param warnings - sink for one warning per dropped source, shaped like every
 *   other generation warning so a caller can hand in the same array it already
 *   collects. Both docx entry paths do: a dropped face renders as a fallback,
 *   which is precisely the silent substitution this pipeline exists to make
 *   visible, so it must not be discoverable only by reading the code.
 */
export function toRasterizeFontFaces(
  fonts: readonly ResolvedFont[],
  warnings?: GenerationWarning[]
): RasterizeFontFace[] {
  const faces: RasterizeFontFace[] = [];
  for (const font of fonts) {
    if (font.sources.length === 0) continue;
    for (const source of font.sources) {
      if (!STAGEABLE_FORMATS.has(source.format)) {
        warnings?.push({
          component: 'fontRegistry',
          severity: 'warning',
          context: { code: 'FONT_FORMAT_NOT_RASTERIZABLE' },
          message:
            `"${font.family}" weight ${source.weight}` +
            `${source.italic ? ' italic' : ''} is ${source.format}; the rasterizer's ` +
            `font stagers only register TTF/OTF, so this face is omitted and the ` +
            `visual renders with a fallback face.`,
        });
        continue;
      }
      faces.push({
        family: font.family,
        weight: source.weight,
        italic: source.italic,
        data: source.data.toString('base64'),
        format: source.format as RasterizeFontFace['format'],
      });
    }
  }
  return faces;
}

/**
 * Inverse of {@link toRasterizeFontFaces}: regroup wire faces back into
 * `ResolvedFont[]` so the existing `FontStager.stage(ResolvedFont[], …)`
 * signature needs no change. Grouping is by exact (case-sensitive) family,
 * matching how the registry keys resolved fonts.
 */
export function fromRasterizeFontFaces(
  faces: readonly RasterizeFontFace[]
): ResolvedFont[] {
  const byFamily = new Map<string, ResolvedFont>();
  for (const face of faces) {
    let font = byFamily.get(face.family);
    if (!font) {
      font = { family: face.family, sources: [], warnings: [] };
      byFamily.set(face.family, font);
    }
    const source: ResolvedFontSource = {
      data: Buffer.from(face.data, 'base64'),
      weight: face.weight,
      italic: face.italic,
      format: face.format ?? 'ttf',
    };
    font.sources.push(source);
  }
  return [...byFamily.values()];
}

/** Formats a browser's `@font-face` can load; a chart is drawn by one. */
const BROWSER_FORMATS = new Set<ResolvedFontSource['format']>([
  'ttf',
  'otf',
  'woff',
  'woff2',
]);

/**
 * Flatten resolved fonts into the faces a Highcharts export server can be
 * handed as inline `@font-face` rules. Wider than `toRasterizeFontFaces`:
 * the chart is drawn by Chromium, which reads WOFF and WOFF2 as readily as
 * an sfnt, so only formats no browser loads are dropped. Safe-only fonts
 * carry no bytes and are skipped; the server's own host faces cover them.
 */
export function toChartFontFaces(
  fonts: readonly ResolvedFont[]
): RasterizeFontFace[] {
  const faces: RasterizeFontFace[] = [];
  for (const font of fonts) {
    for (const source of font.sources) {
      if (!BROWSER_FORMATS.has(source.format)) continue;
      faces.push({
        family: font.family,
        weight: source.weight,
        italic: source.italic,
        data: source.data.toString('base64'),
        format: source.format as RasterizeFontFace['format'],
      });
    }
  }
  return faces;
}
