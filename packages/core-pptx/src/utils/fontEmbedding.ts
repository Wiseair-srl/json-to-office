/**
 * PPTX font embedding post-process.
 *
 * pptxgenjs has no native API for embedding font binaries. We generate the
 * .pptx buffer normally, then run it through `pptx-embed-fonts` which patches
 * the zip to add font parts, update fontTable/presentation.xml, and rewrite
 * relationships.
 *
 * Running as a post-process (rather than wrapping the PptxGenJS class) keeps
 * our slide pipeline untouched — if pptx-embed-fonts API drifts, the fix is
 * contained to this file.
 */

import type { ResolvedFont, ResolvedFontSource } from '@json-to-office/shared';
import type { PipelineWarning } from '../types';
import { warn, W } from './warn';

type FontType = 'ttf' | 'otf' | 'woff' | 'eot';

function sourceToFontType(source: ResolvedFontSource): FontType | null {
  if (source.format === 'ttf') return 'ttf';
  if (source.format === 'otf') return 'otf';
  if (source.format === 'woff') return 'woff';
  if (source.format === 'eot') return 'eot';
  return null;
}

/** Node `Buffer` → standalone `ArrayBuffer` copy expected by pptx-embed-fonts. */
function bufferToArrayBuffer(buf: Buffer): ArrayBuffer {
  const ab = new ArrayBuffer(buf.byteLength);
  new Uint8Array(ab).set(buf);
  return ab;
}

/**
 * Embed every resolved font that has `willEmbed: true` into the .pptx buffer.
 * Returns the new buffer; if no embeddable fonts, returns the input unchanged.
 */
export async function embedFontsInPptx(
  pptxBuffer: Buffer,
  resolvedFonts: ResolvedFont[],
  warnings?: PipelineWarning[]
): Promise<Buffer> {
  const embeddable = resolvedFonts.filter(
    (r) => r.willEmbed && r.sources.length > 0
  );
  if (embeddable.length === 0) return pptxBuffer;

  // Lazy import — keeps bundle size down for callers that never embed fonts.
  const { default: PPTXEmbedFonts } = await import('pptx-embed-fonts');
  const embedder = new PPTXEmbedFonts();
  await embedder.load(bufferToArrayBuffer(pptxBuffer));

  for (const resolved of embeddable) {
    for (const source of resolved.sources) {
      const fontType = sourceToFontType(source);
      if (!fontType) {
        warn(
          warnings,
          W.FONT_EMBED_FAILED,
          `Font "${resolved.family}" source has unsupported format "${source.format}" — skipped.`,
          { component: 'fontRegistry' }
        );
        continue;
      }
      const ab = bufferToArrayBuffer(source.data);
      try {
        if (fontType === 'ttf') {
          await embedder.addFontFromTTF(resolved.family, ab);
        } else if (fontType === 'otf') {
          await embedder.addFontFromOTF(resolved.family, ab);
        } else if (fontType === 'woff') {
          await embedder.addFontFromWOFF(resolved.family, ab);
        } else if (fontType === 'eot') {
          await embedder.addFontFromEOT(resolved.family, ab);
        }
      } catch (err) {
        warn(
          warnings,
          W.FONT_EMBED_FAILED,
          `Failed to embed font "${resolved.family}" (${fontType}): ${
            (err as Error).message
          }`,
          { component: 'fontRegistry' }
        );
      }
    }
  }

  const result = await embedder.save();
  // `save()` may return `ArrayBuffer` or `Buffer`; normalize to Buffer.
  if (Buffer.isBuffer(result)) return result;
  return Buffer.from(result as ArrayBuffer);
}
