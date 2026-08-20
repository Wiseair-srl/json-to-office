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

/**
 * Flatten resolved fonts into the serializable wire faces (one face per
 * source variant). Entries with no sources — safe-only fonts, which the
 * renderer resolves against system faces — carry no bytes and are skipped.
 */
export function toRasterizeFontFaces(
  fonts: readonly ResolvedFont[]
): RasterizeFontFace[] {
  const faces: RasterizeFontFace[] = [];
  for (const font of fonts) {
    if (font.sources.length === 0) continue;
    for (const source of font.sources) {
      faces.push({
        family: font.family,
        weight: source.weight,
        italic: source.italic,
        data: source.data.toString('base64'),
        // `unknown` is not a wire format; omitting it lets the decoder pick
        // its default rather than round-tripping a non-value.
        ...(source.format !== 'unknown' && {
          format: source.format as RasterizeFontFace['format'],
        }),
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
