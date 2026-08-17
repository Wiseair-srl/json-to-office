import JSZip from 'jszip';
import type { PendingXmlFill } from '../types';

const MEDIUM_STYLE_2_ACCENT_1 = '{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}';
const NO_STYLE_NO_GRID = '{2D5ABB26-0587-4C30-8999-92F81FD0307C}';

/** Stable default shared by package entries and OOXML core metadata. */
export const DEFAULT_GENERATED_AT = '2000-01-01T00:00:00.000Z';

export interface PresentationPackagingOptions {
  /** Normalize metadata and ZIP timestamps. Defaults to true. */
  deterministic?: boolean;
  /** Clock used when deterministic packaging is enabled. */
  generatedAt?: Date | string;
  /**
   * Gradient/pattern fills registered during rendering. Each entry names a
   * shape (via its sentinel `cNvPr name`) whose `<a:solidFill>` is swapped for
   * the registered fill XML.
   */
  pendingFills?: PendingXmlFill[];
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

function resolveGeneratedAt(value?: Date | string): Date {
  const date =
    value === undefined ? new Date(DEFAULT_GENERATED_AT) : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid generatedAt value: ${String(value)}`);
  }
  if (date.getUTCFullYear() < 1980) {
    throw new Error(
      'generatedAt must be on or after 1980-01-01 for ZIP compatibility'
    );
  }
  return date;
}

function replaceCoreTimestamp(
  xml: string,
  tag: 'created' | 'modified',
  value: string
): string {
  const expression = new RegExp(
    `(<dcterms:${tag}\\b[^>]*>)[^<]*(</dcterms:${tag}>)`,
    'g'
  );
  return xml.replace(expression, `$1${value}$2`);
}

const EMBEDDED_OFFICE_PACKAGE = /\.(?:docx|pptx|xlsx|xlsm)$/i;

function remapChartReferences(
  value: string,
  chartIds: ReadonlyMap<number, number>
): string {
  return value
    .replace(/chart(\d+)\.xml/g, (match, rawId: string) => {
      const id = chartIds.get(Number(rawId));
      return id === undefined ? match : `chart${id}.xml`;
    })
    .replace(
      /Microsoft_Excel_Worksheet(\d+)\.xlsx/g,
      (match, rawId: string) => {
        const id = chartIds.get(Number(rawId));
        return id === undefined ? match : `Microsoft_Excel_Worksheet${id}.xlsx`;
      }
    );
}

async function canonicalizeChartIds(zip: JSZip): Promise<void> {
  const sourceIds = Object.keys(zip.files)
    .map((path) => path.match(/^ppt\/charts\/chart(\d+)\.xml$/)?.[1])
    .filter((value): value is string => value !== undefined)
    .map(Number)
    .sort((a, b) => a - b);
  const chartIds = new Map(sourceIds.map((id, index) => [id, index + 1]));
  if (chartIds.size === 0) return;

  // Rewrite relationship/content-type targets using one mapping pass so
  // overlapping IDs (2→1, 3→2) cannot cascade into each other.
  for (const [path, entry] of Object.entries(zip.files)) {
    if (entry.dir || (!path.endsWith('.xml') && !path.endsWith('.rels'))) {
      continue;
    }
    const xml = await entry.async('string');
    const remapped = remapChartReferences(xml, chartIds);
    if (remapped !== xml) zip.file(path, remapped);
  }

  const renames: Array<{
    from: string;
    to: string;
    data: Buffer;
    date: Date;
  }> = [];
  for (const [path, entry] of Object.entries(zip.files)) {
    if (entry.dir) continue;
    const remappedPath = remapChartReferences(path, chartIds);
    if (remappedPath === path) continue;
    renames.push({
      from: path,
      to: remappedPath,
      data: await entry.async('nodebuffer'),
      date: entry.date,
    });
  }

  // Remove every source before adding destinations to avoid overwriting a
  // source path that another chart still needs.
  for (const entry of renames) zip.remove(entry.from);
  for (const entry of renames) {
    zip.file(entry.to, entry.data, { date: entry.date });
  }
}

async function generateZip(zip: JSZip): Promise<Buffer> {
  return (await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
    platform: 'DOS',
    streamFiles: false,
  })) as Buffer;
}

async function canonicalizePackage(
  zip: JSZip,
  generatedAt: Date,
  depth = 0
): Promise<void> {
  const timestamp = generatedAt.toISOString().replace(/\.\d{3}Z$/, 'Z');
  const coreEntry = zip.file('docProps/core.xml');
  if (coreEntry) {
    let coreXml = await coreEntry.async('string');
    coreXml = replaceCoreTimestamp(coreXml, 'created', timestamp);
    coreXml = replaceCoreTimestamp(coreXml, 'modified', timestamp);
    zip.file('docProps/core.xml', coreXml);
  }

  // Native charts contain generated XLSX packages with their own volatile
  // core.xml and ZIP timestamps. Normalize those recursively as well, or an
  // otherwise-stable outer PPTX still changes bytes on every build.
  if (depth < 3) {
    for (const [path, entry] of Object.entries(zip.files)) {
      if (entry.dir || !EMBEDDED_OFFICE_PACKAGE.test(path)) continue;
      try {
        const nested = await JSZip.loadAsync(await entry.async('nodebuffer'));
        await canonicalizePackage(nested, generatedAt, depth + 1);
        zip.file(path, await generateZip(nested));
      } catch {
        // Opaque/encrypted user-provided packages cannot be normalized safely.
      }
    }
  }

  for (const entry of Object.values(zip.files)) {
    entry.date = generatedAt;
  }
}

/**
 * Apply post-generation OOXML fixes and deterministic package metadata.
 *
 * PptxGenJS stamps both core.xml and ZIP entries with the wall clock. Rewriting
 * both layers makes equivalent inputs byte-identical across invocations.
 */
export async function packagePresentationBuffer(
  buffer: Buffer,
  options: PresentationPackagingOptions = {}
): Promise<Buffer> {
  const zip = await JSZip.loadAsync(buffer);
  let changed = false;

  for (const [path, entry] of Object.entries(zip.files)) {
    if (!path.match(/^ppt\/slides\/slide\d+\.xml$/)) continue;
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

  if (options.deterministic !== false) {
    const generatedAt = resolveGeneratedAt(options.generatedAt);
    await canonicalizeChartIds(zip);
    await canonicalizePackage(zip, generatedAt);
    changed = true;
  }

  if (!changed) return buffer;

  return generateZip(zip);
}
