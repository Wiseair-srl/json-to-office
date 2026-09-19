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
 * - **Picture fills.** A radial gradient ships as a PNG (`radialRaster.ts`);
 *   its `<a:blipFill>` needs a media part and a slide relationship, which
 *   PptxGenJS never created, so the splice adds both.
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
import type JSZip from 'jszip';
import { repairSvgRasterFallbacks } from './svgRasterFallback';
import { IMAGE_FILL_RID } from './fills';
import type { PendingXmlFill, PipelineWarning } from '../../types';

/** PptxGenJS hard-codes this on every table it writes. */
const MEDIUM_STYLE_2_ACCENT_1 = '{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}';
const NO_STYLE_NO_GRID = '{2D5ABB26-0587-4C30-8999-92F81FD0307C}';

const SLIDE_PART = /^ppt\/slides\/slide\d+\.xml$/;
const IMAGE_REL_TYPE =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image';

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
  pendingFills: readonly PendingXmlFill[],
  spliced: SplicedImageFill[] = []
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
      // A picture fill gets an embed token unique to this fill, resolved to
      // a relationship id once the slide's relationships are known.
      let fillXml = fill.xml;
      if (fill.image) {
        const token = `${IMAGE_FILL_RID}${index}`;
        fillXml = fillXml.replace(IMAGE_FILL_RID, token);
        spliced.push({ token, image: fill.image });
      }
      out =
        out.slice(0, solidStart) +
        fillXml +
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

/** A picture fill spliced into a slide, awaiting its relationship. */
interface SplicedImageFill {
  token: string;
  image: Uint8Array;
}

/**
 * Give each spliced picture fill on one slide a media part and a relationship,
 * and point its placeholder embed at it. Identical bytes share one part — the
 * rasterizer returns one array per distinct gradient — so a gradient repeated
 * across slides ships once.
 */
async function linkImageFills(
  zip: JSZip,
  slidePath: string,
  xml: string,
  images: readonly SplicedImageFill[],
  media: Map<Uint8Array, string>
): Promise<string> {
  if (images.length === 0) return xml;

  const relsPath = slidePath.replace(
    /^ppt\/slides\/(slide\d+\.xml)$/,
    'ppt/slides/_rels/$1.rels'
  );
  let rels =
    (await zip.file(relsPath)?.async('string')) ??
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>';
  let nextId =
    Math.max(
      0,
      ...[...rels.matchAll(/\bId="rId(\d+)"/g)].map((match) => Number(match[1]))
    ) + 1;

  let out = xml;
  for (const { token, image } of images) {
    let part = media.get(image);
    if (!part) {
      part = `ppt/media/jto-gradient-${media.size + 1}.png`;
      media.set(image, part);
      zip.file(part, image);
    }
    const rId = `rId${nextId}`;
    nextId += 1;
    rels = rels.replace(
      '</Relationships>',
      `<Relationship Id="${rId}" Type="${IMAGE_REL_TYPE}" Target="../media/${part.slice('ppt/media/'.length)}"/></Relationships>`
    );
    out = out.replace(`r:embed="${token}"`, `r:embed="${rId}"`);
  }
  zip.file(relsPath, rels);
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
  const media = new Map<Uint8Array, string>();

  for (const [path, entry] of Object.entries(zip.files)) {
    if (!SLIDE_PART.test(path)) continue;
    let xml = await entry.async('string');
    let fileChanged = false;
    if (xml.includes(MEDIUM_STYLE_2_ACCENT_1)) {
      xml = xml.replaceAll(MEDIUM_STYLE_2_ACCENT_1, NO_STYLE_NO_GRID);
      fileChanged = true;
    }
    if (options.pendingFills?.length) {
      const spliced: SplicedImageFill[] = [];
      let withFills = applyPendingFills(xml, options.pendingFills, spliced);
      withFills = await linkImageFills(zip, path, withFills, spliced, media);
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
