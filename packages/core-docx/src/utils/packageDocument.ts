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

/** Encode a UTC instant into the packed MS-DOS date/time field ZIP headers use. */
function toDosTime(date: Date): number {
  const dosDate =
    (((date.getUTCFullYear() - 1980) & 0x7f) << 9) |
    ((date.getUTCMonth() + 1) << 5) |
    date.getUTCDate();
  const dosTime =
    (date.getUTCHours() << 11) |
    (date.getUTCMinutes() << 5) |
    (date.getUTCSeconds() >> 1);
  return ((dosDate << 16) | dosTime) >>> 0;
}

/**
 * Normalize package-level values that otherwise change on every render.
 * ZIP headers are written from UTC components because DOS timestamps carry no
 * timezone; this produces identical header bits in every locale.
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

  // AdmZip's `header.time` setter encodes the timezone-less DOS field from
  // local getters, so the emitted bits would vary by host. Write the raw field
  // from UTC components instead. Going through a reconstructed local Date is
  // not enough: a value inside a DST spring-forward gap has no local
  // representation and the runtime silently shifts it an hour.
  // `timeval` is the raw DOS field; @types/adm-zip@0.5.7 only declares the
  // `time` Date accessor that wraps it, hence the cast.
  const zipTimestamp = toDosTime(generatedAt);
  for (const entry of zip.getEntries()) {
    (entry.header as unknown as { timeval: number }).timeval = zipTimestamp;
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
