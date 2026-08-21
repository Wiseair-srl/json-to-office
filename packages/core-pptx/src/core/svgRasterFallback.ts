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
 * best-effort repair: any failure leaves the placeholder in place and reports
 * a warning, because a broken preview still beats a package that failed to
 * build.
 */
import path from 'node:path';
import type JSZip from 'jszip';
import type { PipelineWarning } from '../types';
import { W, warn } from '../utils/warn';

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
 * native binding or an SVG resvg rejects degrades to a warning and leaves the
 * package as generated.
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
    return false;
  }

  const rendered = new Map<string, Buffer>();
  let changed = false;

  for (const [pngPart, item] of pending) {
    try {
      // Repair only a preview that is really there: a dangling relationship
      // target would otherwise have this pass author a brand new media part.
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
    }
  }

  return changed;
}
