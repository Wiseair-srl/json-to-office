/**
 * Generic OOXML package finalization.
 *
 * Canonical chart identifiers, pinned core-metadata and ZIP timestamps, and a
 * stable zip encoding. Every one of those is a property of the package rather
 * than of the backend that produced it, so any renderer's output goes through
 * this and nothing here knows which one ran.
 *
 * Backend repairs — the sentinel gradient/pattern splice, the table-style
 * GUID, the SVG preview fix — live with the backend that needs them, in
 * `renderers/pptxgenjs/packaging.ts`. Both halves share one `JSZip` so the
 * package is still read once and written once.
 */

import JSZip from 'jszip';

/** Stable default shared by package entries and OOXML core metadata. */
export const DEFAULT_GENERATED_AT = '2000-01-01T00:00:00.000Z';

/** What a caller may say about how the package is stamped. */
export interface PresentationPackagingOptions {
  /** Normalize metadata and ZIP timestamps. Defaults to true. */
  deterministic?: boolean;
  /** Clock used when deterministic packaging is enabled. */
  generatedAt?: Date | string;
}

export async function readPackage(buffer: Buffer): Promise<JSZip> {
  return JSZip.loadAsync(buffer);
}

export async function writePackage(zip: JSZip): Promise<Buffer> {
  return generateZip(zip);
}

export function resolveGeneratedAt(value?: Date | string): Date {
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

/**
 * Finalize a package in place: canonical chart ids, then pinned timestamps.
 *
 * In place rather than buffer-in/buffer-out so an adapter that has already
 * opened the zip for its own repairs does not pay for a second pass.
 */
export async function finalizePackage(
  zip: JSZip,
  generatedAt: Date
): Promise<void> {
  await canonicalizeChartIds(zip);
  await canonicalizePackage(zip, generatedAt);
}

/** Finalize a package a caller holds only as bytes. */
export async function finalizePackageBuffer(
  buffer: Buffer,
  options: { generatedAt?: Date | string } = {}
): Promise<Buffer> {
  const zip = await readPackage(buffer);
  await finalizePackage(zip, resolveGeneratedAt(options.generatedAt));
  return writePackage(zip);
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
