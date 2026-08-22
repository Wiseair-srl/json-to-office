/**
 * Packaging for PptxGenJS output.
 *
 * Everything here exists because of what PptxGenJS emits, and would be wrong
 * to apply to another backend's bytes:
 *
 * - **Gradient and pattern fills.** The library has no API for either, so the
 *   emitter registers the fill XML against a sentinel shape name and this pass
 *   splices it in, restoring a normal name on the way out.
 * - **The table style GUID.** PptxGenJS hard-codes Medium Style 2 Accent 1 on
 *   every table, which paints banding and accent borders the author never
 *   asked for. Swapping it for No Style No Grid leaves the explicit borders
 *   the emitter already wrote.
 * - **SVG previews.** The library builds them with a browser canvas, so under
 *   Node it writes a broken-image placeholder — see `svgRasterFallback.ts`.
 *
 * Deterministic timestamps, canonical chart ids and the zip encoding are not
 * repairs; they are properties of an OOXML package. Those live in
 * `core/finalizePackage.ts` and run on the same open zip, so the package is
 * still read once and written once — which is what the byte-stable corpus was
 * recorded against.
 */

import {
  finalizePackage,
  readPackage,
  resolveGeneratedAt,
  writePackage,
} from '../../core/finalizePackage';
import { repairSvgRasterFallbacks } from './svgRasterFallback';
import type { PendingXmlFill, PipelineWarning } from '../../types';

/** PptxGenJS hard-codes this on every table it writes. */
const MEDIUM_STYLE_2_ACCENT_1 = '{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}';
const NO_STYLE_NO_GRID = '{2D5ABB26-0587-4C30-8999-92F81FD0307C}';

const SLIDE_PART = /^ppt\/slides\/slide\d+\.xml$/;

export interface PptxGenJsPackagingOptions {
  /**
   * Gradient/pattern fills registered during rendering. Each entry names a
   * shape (via its sentinel `cNvPr name`) whose `<a:solidFill>` is swapped for
   * the registered fill XML.
   */
  pendingFills?: readonly PendingXmlFill[];
  /** Normalize metadata and ZIP timestamps. Defaults to true. */
  deterministic?: boolean;
  /** Clock used when deterministic packaging is enabled. */
  generatedAt?: Date | string;
  /**
   * Sink for repairs that need to report, e.g. an SVG that cannot rasterize.
   * When omitted their failures go to `console.warn`.
   */
  warnings?: PipelineWarning[];
}

/**
 * Splice registered gradient/pattern fills into a slide XML string. For every
 * pending fill whose sentinel objectName appears in this slide, the first
 * `<a:solidFill>` inside that shape's `<p:sp>` (its shape fill — line and run
 * fills come later in the element) is replaced with the registered fill XML,
 * and the sentinel marker name is swapped for a normal shape name.
 */
function applyPendingFills(
  xml: string,
  pendingFills: readonly PendingXmlFill[]
): string {
  let out = xml;
  for (const [index, fill] of pendingFills.entries()) {
    const marker = `name="${fill.objectName}"`;
    const markerIdx = out.indexOf(marker);
    if (markerIdx === -1) continue;

    const spEnd = out.indexOf('</p:sp>', markerIdx);
    const solidStart = out.indexOf('<a:solidFill>', markerIdx);
    const solidEndTag = '</a:solidFill>';
    const solidEnd = out.indexOf(solidEndTag, solidStart);
    if (
      solidStart !== -1 &&
      solidEnd !== -1 &&
      spEnd !== -1 &&
      solidStart < spEnd
    ) {
      out =
        out.slice(0, solidStart) +
        fill.xml +
        out.slice(solidEnd + solidEndTag.length);
    }

    // Restore a normal name attribute so the sentinel never ships.
    out =
      out.slice(0, markerIdx) +
      `name="Fill ${index + 1}"` +
      out.slice(markerIdx + marker.length);
  }
  return out;
}

/**
 * Apply the backend repairs, then hand the same zip to generic finalization.
 *
 * Returns the input buffer untouched when nothing needed doing, which only
 * happens with `deterministic: false` — PptxGenJS stamps both `core.xml` and
 * its ZIP entries with the wall clock, so a deterministic build always
 * rewrites something.
 */
export async function packagePptxGenJsBuffer(
  buffer: Buffer,
  options: PptxGenJsPackagingOptions = {}
): Promise<Buffer> {
  const zip = await readPackage(buffer);
  let changed = false;

  for (const [path, entry] of Object.entries(zip.files)) {
    if (!SLIDE_PART.test(path)) continue;
    let xml = await entry.async('string');
    let fileChanged = false;
    if (xml.includes(MEDIUM_STYLE_2_ACCENT_1)) {
      xml = xml.replaceAll(MEDIUM_STYLE_2_ACCENT_1, NO_STYLE_NO_GRID);
      fileChanged = true;
    }
    if (options.pendingFills?.length) {
      const withFills = applyPendingFills(xml, options.pendingFills);
      if (withFills !== xml) {
        xml = withFills;
        fileChanged = true;
      }
    }
    if (fileChanged) {
      zip.file(path, xml);
      changed = true;
    }
  }

  changed = (await repairSvgRasterFallbacks(zip, options.warnings)) || changed;

  if (options.deterministic !== false) {
    await finalizePackage(zip, resolveGeneratedAt(options.generatedAt));
    changed = true;
  }

  if (!changed) return buffer;

  return writePackage(zip);
}
