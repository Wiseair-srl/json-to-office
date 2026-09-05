import AdmZip from 'adm-zip';

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
export function toDosTime(date: Date): number {
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
 * A relationship id that is stable across runs.
 *
 * docx.js numbers most relationships `rId1`, `rId2`, … but mints ids for
 * external hyperlinks from `Math.random`, so any document containing a link
 * produced different bytes on every render. Canonicalizing them here is
 * generic package finalization — it is a property of an OOXML package, not of
 * any one backend — and it is what makes a hyperlink-bearing document
 * reproducible at all.
 */
const STABLE_RELATIONSHIP_ID = /^rId\d+$/;

/**
 * Rewrite volatile relationship ids to a stable sequence.
 *
 * Ids are renumbered per part, continuing past the highest number that part
 * already uses so nothing can collide with an id docx.js allocated. Order
 * follows first appearance in the owning part, which depends only on document
 * content — not on allocation order, and not on a clock.
 */
function canonicalizeRelationshipIds(zip: AdmZip): void {
  // Two phases. Updating entries while walking `getEntries()` rebuilds
  // adm-zip's internal list, after which a `getEntry` lookup for the owning
  // part can miss — which renamed the relationship without renaming the
  // reference to it. Collect first, then apply.
  const relsNames = zip
    .getEntries()
    .map((entry) => entry.entryName)
    .filter((name) => /^(.*\/)?_rels\/(.+)\.rels$/.test(name));

  const updates: Array<{ name: string; xml: string }> = [];

  for (const relsName of relsNames) {
    const match = /^(.*\/)?_rels\/(.+)\.rels$/.exec(relsName);
    if (!match) continue;

    const relsEntry = zip.getEntry(relsName);
    if (!relsEntry) continue;
    const relsXml = relsEntry.getData().toString('utf8');

    const ids = [...relsXml.matchAll(/\bId="([^"]+)"/g)].map((m) => m[1]);
    const unstable = ids.filter((id) => !STABLE_RELATIONSHIP_ID.test(id));
    if (unstable.length === 0) continue;

    const partName = `${match[1] ?? ''}${match[2]}`;
    const partEntry = zip.getEntry(partName);
    const partXml = partEntry?.getData().toString('utf8') ?? '';

    // First appearance in the part decides the order; anything the part never
    // references keeps its position from the relationships file.
    const ordered = [...unstable].sort((a, b) => {
      const ia = partXml.indexOf(`"${a}"`);
      const ib = partXml.indexOf(`"${b}"`);
      if (ia === ib) return unstable.indexOf(a) - unstable.indexOf(b);
      if (ia === -1) return 1;
      if (ib === -1) return -1;
      return ia - ib;
    });

    const highest = ids.reduce((max, id) => {
      const numeric = /^rId(\d+)$/.exec(id);
      return numeric ? Math.max(max, Number(numeric[1])) : max;
    }, 0);

    const rename = new Map(
      ordered.map((id, index) => [id, `rId${highest + 1 + index}`])
    );

    // One pass over quoted tokens, so a freshly assigned id can never be
    // rewritten again by a later entry in the map.
    const rewrite = (xml: string): string =>
      xml.replace(/"([^"]+)"/g, (whole, value: string) => {
        const replacement = rename.get(value);
        return replacement === undefined ? whole : `"${replacement}"`;
      });

    updates.push({ name: relsName, xml: rewrite(relsXml) });
    if (partEntry) {
      updates.push({ name: partName, xml: rewrite(partXml) });
    }
  }

  for (const update of updates) {
    const entry = zip.getEntry(update.name);
    if (entry) zip.updateFile(entry, Buffer.from(update.xml, 'utf8'));
  }
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
  normalizeTextCase(zip);
  canonicalizeRelationshipIds(zip);

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

/** Case semantics also apply when timestamp normalization is disabled. */
export function normalizeDocxCaseBuffer(buffer: Buffer): Buffer {
  const zip = new AdmZip(buffer);
  return normalizeTextCase(zip) ? zip.toBuffer() : buffer;
}

function normalizeTextCase(zip: AdmZip): boolean {
  let changed = false;
  for (const entry of zip.getEntries()) {
    // Both writers emit only one caps flag. State the opposite flag as false
    // so case changes (including `none`) can override an inherited style.
    if (/^word\/.*\.xml$/.test(entry.entryName)) {
      const xml = entry.getData().toString('utf8');
      if (/<w:(?:caps|smallCaps)\b/.test(xml)) {
        const normalized = xml.replace(
          /<w:rPr\b[^>]*>[\s\S]*?<\/w:rPr>/g,
          (run) => {
            const caps = /<w:caps\b/.test(run);
            const small = /<w:smallCaps\b/.test(run);
            if (caps === small) return run;
            return run.replace(
              '</w:rPr>',
              `<w:${caps ? 'smallCaps' : 'caps'} w:val="false"/></w:rPr>`
            );
          }
        );
        if (normalized !== xml) {
          zip.updateFile(entry, Buffer.from(normalized, 'utf8'));
          changed = true;
        }
      }
    }
  }
  return changed;
}
