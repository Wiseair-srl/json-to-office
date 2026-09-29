/**
 * Raster fallbacks for inline SVG pictures (PPTX)
 *
 * An SVG picture ships as two media parts: the SVG itself, referenced by
 * `<asvg:svgBlip>` inside the blip's `<a:extLst>`, plus a PNG preview
 * referenced by the `<a:blip r:embed>` that every consumer understands.
 * PptxGenJS builds that preview with a browser canvas, so under Node it
 * writes its hardcoded broken-image placeholder instead
 * (gitbrent/PptxGenJS#401) and every viewer without svgBlip support —
 * LibreOffice <= 7.x, Google Slides, Office < 2016 — draws a red X.
 *
 * This pass rasterizes each SVG part and overwrites its paired PNG. It is a
 * best-effort repair: any failure writes the placeholder and reports a
 * warning, because a broken preview still beats a package that failed to
 * build.
 */
import path from 'node:path';
import type JSZip from 'jszip';
import type { PipelineWarning } from '../../types';
import { W, warn } from '../../utils/warn';

type ResvgModule = typeof import('@resvg/resvg-js');
type FitTo = { mode: 'width' | 'height'; value: number };

const EMU_PER_INCH = 914400;
/** 3x of PowerPoint's 96 DPI baseline — ~288 DPI, sharp when projected. */
const RASTER_SCALE = 3;
const MAX_EDGE_PX = 4096;
const MIN_EDGE_PX = 16;
/** Used when a picture carries no `<a:xfrm>` extent to size against. */
const DEFAULT_EDGE_PX = 1024;

const PART_PATTERNS = [
  /^ppt\/slides\/slide\d+\.xml$/,
  /^ppt\/slideLayouts\/[^/]+\.xml$/,
  /^ppt\/slideMasters\/[^/]+\.xml$/,
];

const SVG_BLIP = /<asvg:svgBlip\b[^>]*r:embed="([^"]+)"/g;
const BLIP = /<a:blip\b[^>]*r:embed="([^"]+)"/g;
const EXTENT = /<a:ext\s+cx="(\d+)"\s+cy="(\d+)"/;
const RELATIONSHIP = /<Relationship\b([^>]*)>/g;

/**
 * The preview a failed repair leaves: PptxGenJS 3's hardcoded Node fallback
 * (`IMG_BROKEN`, a 100x119 red-X PNG), byte for byte.
 *
 * Written here rather than left to PptxGenJS. Version 4 still means to write
 * it, but does so from a promise nothing awaits (step 5 of
 * `encodeSlideMediaRels`): until `node:fs` has loaded, the preview part keeps
 * the SVG's own text instead. What a failed repair left behind then depended
 * on timing, and so did the package.
 */
export const SVG_PREVIEW_PLACEHOLDER = Buffer.from(
  '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',
  'base64'
);

interface WorkItem {
  svgPart: string;
  cx?: number;
  cy?: number;
}

let resvgModule: Promise<ResvgModule> | undefined;

function loadResvg(): Promise<ResvgModule> {
  resvgModule ??= import('@resvg/resvg-js');
  return resvgModule;
}

/** Map `Id` -> package-absolute part path for one part's sibling .rels file. */
async function readRelationships(
  zip: JSZip,
  partPath: string
): Promise<Map<string, string>> {
  const dir = path.posix.dirname(partPath);
  const relsPath = `${dir}/_rels/${path.posix.basename(partPath)}.rels`;
  const targets = new Map<string, string>();
  const entry = zip.file(relsPath);
  if (!entry) return targets;

  const xml = await entry.async('string');
  for (const match of xml.matchAll(RELATIONSHIP)) {
    const attrs = match[1];
    if (/\bTargetMode="External"/.test(attrs)) continue;
    const id = /\bId="([^"]+)"/.exec(attrs)?.[1];
    const target = /\bTarget="([^"]+)"/.exec(attrs)?.[1];
    if (!id || !target) continue;
    targets.set(
      id,
      target.startsWith('/')
        ? target.slice(1)
        : path.posix.normalize(path.posix.join(dir, target))
    );
  }
  return targets;
}

/**
 * Collect the svg/png part pairs referenced by one slide-family part. The
 * preview rId is the `<a:blip r:embed>` immediately preceding the svgBlip —
 * the svgBlip lives inside that blip's own `<a:extLst>` — and the placed size
 * is the `<a:ext cx cy>` that follows it inside the same `<p:pic>`.
 */
function collectWorkItems(
  xml: string,
  rels: ReadonlyMap<string, string>,
  items: Map<string, WorkItem>
): void {
  const blips = [...xml.matchAll(BLIP)];

  for (const svgBlip of xml.matchAll(SVG_BLIP)) {
    const at = svgBlip.index ?? 0;
    const preview = blips.filter((blip) => (blip.index ?? 0) < at).pop();
    if (!preview) continue;

    const pngPart = rels.get(preview[1]);
    const svgPart = rels.get(svgBlip[1]);
    if (!pngPart || !svgPart) continue;

    const picEnd = xml.indexOf('</p:pic>', at);
    const extent = EXTENT.exec(picEnd === -1 ? '' : xml.slice(at, picEnd));
    const cx = extent ? Number(extent[1]) : undefined;
    const cy = extent ? Number(extent[2]) : undefined;

    // PptxGenJS can point two pictures at one preview part; size it for the
    // largest box it has to cover. The axes max independently on purpose:
    // resvg scales uniformly, so one bitmap covers every box that shares the
    // part only when its width clears the widest and its height the tallest.
    // Keeping whichever single box is largest by area undersizes the other.
    const existing = items.get(pngPart);
    items.set(pngPart, {
      svgPart,
      cx: Math.max(cx ?? 0, existing?.cx ?? 0) || undefined,
      cy: Math.max(cy ?? 0, existing?.cy ?? 0) || undefined,
    });
  }
}

function toPixels(emu: number): number {
  const px = Math.round((emu / EMU_PER_INCH) * 96 * RASTER_SCALE);
  return Math.min(MAX_EDGE_PX, Math.max(MIN_EDGE_PX, px));
}

/**
 * Pick the axis to scale by so the bitmap covers the placed box on both axes:
 * an SVG wider than its box has to be sized by height, anything else by width.
 */
function resolveFitTo(
  intrinsicAspect: number,
  cx: number | undefined,
  cy: number | undefined
): FitTo {
  if (!cx || !cy) return { mode: 'width', value: DEFAULT_EDGE_PX };

  const wide = intrinsicAspect > cx / cy;
  const mode = wide ? 'height' : 'width';
  let value = wide ? toPixels(cy) : toPixels(cx);

  const other = wide
    ? Math.round(value * intrinsicAspect)
    : Math.round(value / intrinsicAspect);
  const longest = Math.max(value, other);
  if (longest > MAX_EDGE_PX) {
    value = Math.max(MIN_EDGE_PX, Math.floor((value * MAX_EDGE_PX) / longest));
  }
  return { mode, value };
}

/**
 * Replace the broken-image placeholders PptxGenJS writes for inline SVG
 * pictures with real rasterizations of those SVGs. Never throws: a missing
 * native binding or an SVG resvg rejects degrades to a warning and
 * `SVG_PREVIEW_PLACEHOLDER` in that preview.
 *
 * @returns whether any part of the zip was rewritten.
 */
export async function repairSvgRasterFallbacks(
  zip: JSZip,
  warnings?: PipelineWarning[]
): Promise<boolean> {
  const pending = new Map<string, WorkItem>();

  for (const [partPath, entry] of Object.entries(zip.files)) {
    if (entry.dir || !PART_PATTERNS.some((rule) => rule.test(partPath))) {
      continue;
    }
    const xml = await entry.async('string');
    if (!xml.includes('asvg:svgBlip')) continue;

    collectWorkItems(xml, await readRelationships(zip, partPath), pending);
  }

  if (pending.size === 0) return false;

  let changed = false;
  // Only over a preview that is really there: a dangling relationship target
  // would otherwise have this pass author a brand new media part.
  const keepPlaceholder = (pngPart: string): void => {
    if (!zip.file(pngPart)) return;
    zip.file(pngPart, SVG_PREVIEW_PLACEHOLDER);
    changed = true;
  };

  let Resvg: ResvgModule['Resvg'];
  try {
    ({ Resvg } = await loadResvg());
  } catch (error) {
    warn(
      warnings,
      W.IMAGE_SVG_RASTER_FAILED,
      `Could not load the SVG rasterizer, so inline SVG images keep PowerPoint's broken-image fallback: ${String(error)}`,
      { component: 'image' }
    );
    for (const pngPart of pending.keys()) keepPlaceholder(pngPart);
    return changed;
  }

  const rendered = new Map<string, Buffer>();

  for (const [pngPart, item] of pending) {
    try {
      if (!zip.file(pngPart)) {
        throw new Error(`missing preview part ${pngPart}`);
      }
      const source = zip.file(item.svgPart);
      if (!source) throw new Error(`missing part ${item.svgPart}`);
      const svg = await source.async('string');

      const probe = new Resvg(svg);
      const fitTo = resolveFitTo(probe.width / probe.height, item.cx, item.cy);
      const key = `${fitTo.mode}:${fitTo.value}\n${svg}`;

      let png = rendered.get(key);
      if (!png) {
        png = Buffer.from(new Resvg(svg, { fitTo }).render().asPng());
        rendered.set(key, png);
      }

      // Timestamps are normalized afterwards by canonicalizePackage.
      zip.file(pngPart, png);
      changed = true;
    } catch (error) {
      warn(
        warnings,
        W.IMAGE_SVG_RASTER_FAILED,
        `Could not rasterize ${item.svgPart}, so it keeps PowerPoint's broken-image fallback: ${String(error)}`,
        { component: 'image' }
      );
      keepPlaceholder(pngPart);
    }
  }

  return changed;
}
