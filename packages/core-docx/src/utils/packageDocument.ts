import AdmZip from 'adm-zip';
import { type Document, Packer } from 'docx';
import { fixFloatingImageIdsInBuffer } from './fixFloatingImageIds';

export interface DocumentPackageOptions {
  /** Normalize volatile OOXML metadata and ZIP timestamps. Defaults to true. */
  deterministic?: boolean;
  /** Timestamp used for generated metadata. Defaults to a stable epoch. */
  generatedAt?: string | Date;
}

/** Stable, valid OOXML/ZIP timestamp used when no build timestamp is supplied. */
export const DEFAULT_GENERATION_DATE = new Date('2000-01-01T00:00:00.000Z');

export function resolveGenerationDate(options?: DocumentPackageOptions): Date {
  if (options?.generatedAt !== undefined) {
    const date = new Date(options.generatedAt);
    if (Number.isNaN(date.getTime())) {
      throw new RangeError('generatedAt must be a valid date');
    }
    if (date.getUTCFullYear() < 1980) {
      throw new RangeError(
        'generatedAt must be on or after 1980-01-01 for ZIP compatibility'
      );
    }
    return date;
  }

  return options?.deterministic === false
    ? new Date()
    : new Date(DEFAULT_GENERATION_DATE);
}

/**
 * Normalize package-level values that otherwise change on every render.
 * A local wall-clock value is used for ZIP headers because DOS timestamps do
 * not carry a timezone; this produces identical header bits in every locale.
 */
export function canonicalizeDocxBuffer(
  buffer: Buffer,
  generatedAt: Date = DEFAULT_GENERATION_DATE
): Buffer {
  const zip = new AdmZip(buffer);
  const isoTimestamp = generatedAt.toISOString();
  const coreProperties = zip.getEntry('docProps/core.xml');

  if (coreProperties) {
    const normalized = coreProperties
      .getData()
      .toString('utf8')
      .replace(
        /(<dcterms:(?:created|modified)\b[^>]*>)[^<]*(<\/dcterms:(?:created|modified)>)/g,
        `$1${isoTimestamp}$2`
      );
    zip.updateFile(coreProperties, Buffer.from(normalized, 'utf8'));
  }

  // AdmZip writes local wall-clock fields into the timezone-less DOS header.
  // Rebuild from UTC components so the emitted bits are stable across hosts.
  const zipTimestamp = new Date(
    generatedAt.getUTCFullYear(),
    generatedAt.getUTCMonth(),
    generatedAt.getUTCDate(),
    generatedAt.getUTCHours(),
    generatedAt.getUTCMinutes(),
    generatedAt.getUTCSeconds(),
    0
  );
  for (const entry of zip.getEntries()) {
    entry.header.time = zipTimestamp;
  }

  return zip.toBuffer();
}

/** Package a DOCX and apply all required OOXML post-processing once. */
export async function packageDocument(
  document: Document,
  options?: DocumentPackageOptions
): Promise<Buffer> {
  const packed = (await Packer.toBuffer(document)) as Buffer;
  const fixed = fixFloatingImageIdsInBuffer(packed);

  if (options?.deterministic === false) {
    return fixed;
  }

  return canonicalizeDocxBuffer(fixed, resolveGenerationDate(options));
}
