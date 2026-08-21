/**
 * Pure helpers behind the font picker's "Custom" tab.
 *
 * Two paths produce the same thing — a self-contained `kind:"data"` entry in
 * the active document's `props.fontRegistry`:
 *   1. a local .ttf/.otf the user picks, base64-encoded in the browser;
 *   2. any Google family, fetched server-side via POST /api/fonts/materialize.
 *
 * Everything here is DOM-free so it can be unit-tested: packages/jto runs
 * vitest with the default `node` environment and the repo ships no jsdom, so
 * React components are not testable and all logic must live outside them.
 */

import {
  WEIGHT_LABELS,
  type FontRegistryEntry,
  type FontSource,
} from '@json-to-office/shared';

/**
 * Raw bytes ceiling per uploaded file. The server hard-rejects anything over
 * 5 MB (MAX_DATA_FONT_BYTES in shared/fonts/sources/data-loader.ts); 2 MB
 * keeps base64 inflation (~1.33x) survivable inside the 16 MB
 * /preview/libreoffice-from-json body cap.
 */
export const MAX_UPLOAD_FONT_BYTES = 2 * 1024 * 1024;

/**
 * Whole-document ceiling, checked after the registry write. 16 MB is the
 * binding server limit; 12 MB leaves room for customThemes and the request
 * envelope.
 */
export const MAX_DOCUMENT_JSON_BYTES = 12 * 1024 * 1024;

export type UploadFormat = 'ttf' | 'otf' | 'woff' | 'woff2' | 'unknown';

/**
 * Magic-byte sniff.
 *
 * Deliberately local rather than reusing the shared `detectFontFormat`: that
 * one takes a Node `Buffer`, which does not exist in the browser bundle, and
 * its PostScript branch calls `.toString('ascii')`, which returns a
 * comma-joined digit string on a Uint8Array.
 */
export function sniffFontFormat(bytes: Uint8Array): UploadFormat {
  if (bytes.length < 4) return 'unknown';
  const [b0, b1, b2, b3] = bytes;
  // 0x00010000 (TrueType) or 'true' / 'ttcf'
  if (b0 === 0x00 && b1 === 0x01 && b2 === 0x00 && b3 === 0x00) return 'ttf';
  if (b0 === 0x74 && b1 === 0x72 && b2 === 0x75 && b3 === 0x65) return 'ttf';
  if (b0 === 0x74 && b1 === 0x74 && b2 === 0x63 && b3 === 0x66) return 'ttf';
  // 'OTTO' — CFF-flavoured OpenType
  if (b0 === 0x4f && b1 === 0x54 && b2 === 0x54 && b3 === 0x4f) return 'otf';
  // 'wOFF' / 'wOF2'
  if (b0 === 0x77 && b1 === 0x4f && b2 === 0x46 && b3 === 0x46) return 'woff';
  if (b0 === 0x77 && b1 === 0x4f && b2 === 0x46 && b3 === 0x32) return 'woff2';
  return 'unknown';
}

/**
 * Chunked base64 encoder. `btoa(String.fromCharCode(...bytes))` blows the
 * argument-count stack limit around 100 KB, and a 2 MB font is 20x past that.
 */
export function toBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

export type UploadRejection = { ok: false; message: string };
export type UploadAcceptance = {
  ok: true;
  format: 'ttf' | 'otf';
  base64: string;
};

function formatBytes(n: number): string {
  return n >= 1024 * 1024
    ? `${(n / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.round(n / 1024)} KB`;
}

/**
 * Size + magic-byte gate.
 *
 * Accepts only TTF and OTF. WOFF/WOFF2 are rejected even though the server's
 * data-loader nominally accepts them: the LibreOffice preview stager writes
 * every staged face with a `.ttf` extension, so a woff2 would be staged under
 * a name fontconfig cannot parse and would silently fail to register.
 */
export function validateFontUpload(
  fileName: string,
  bytes: Uint8Array
): UploadAcceptance | UploadRejection {
  if (bytes.length === 0) {
    return { ok: false, message: `"${fileName}" is empty.` };
  }
  if (bytes.length > MAX_UPLOAD_FONT_BYTES) {
    return {
      ok: false,
      message: `"${fileName}" is ${formatBytes(bytes.length)}. The limit is ${formatBytes(
        MAX_UPLOAD_FONT_BYTES
      )} per font, because the bytes travel inside the document JSON.`,
    };
  }
  const format = sniffFontFormat(bytes);
  if (format === 'woff' || format === 'woff2') {
    return {
      ok: false,
      message: `"${fileName}" is a ${format.toUpperCase()} file. Upload the TTF or OTF instead — the preview renderer cannot register web font formats.`,
    };
  }
  if (format !== 'ttf' && format !== 'otf') {
    return {
      ok: false,
      message: `"${fileName}" does not look like a TTF or OTF font file.`,
    };
  }
  return { ok: true, format, base64: toBase64(bytes) };
}

const ITALIC_TOKENS = new Set(['italic', 'oblique']);

/**
 * Guess a family name and weight from a filename, e.g.
 * `Geist-SemiBold.ttf` → `{ family: 'Geist', weight: 600, italic: false }`.
 *
 * Only ever a prefill for an editable field — never authoritative. Parsing
 * the font's internal name table would need Buffer methods (`swap16`,
 * `readUInt16BE`) that have no Uint8Array equivalent in the browser.
 */
export function guessFontIdentity(fileName: string): {
  family: string;
  weight: number;
  italic: boolean;
} {
  const base = fileName.replace(/\.[^.]+$/, '');
  const tokens = base.split(/[-_\s]+/).filter(Boolean);

  const labelToWeight = new Map<string, number>();
  for (const [w, label] of Object.entries(WEIGHT_LABELS)) {
    labelToWeight.set(label.toLowerCase(), Number(w));
  }

  let weight = 400;
  let italic = false;
  // Consume trailing style tokens only; a leading "Bold" is part of the name.
  while (tokens.length > 1) {
    const last = tokens[tokens.length - 1].toLowerCase();
    if (ITALIC_TOKENS.has(last)) {
      italic = true;
      tokens.pop();
      continue;
    }
    const w = labelToWeight.get(last);
    if (w !== undefined) {
      weight = w;
      tokens.pop();
      continue;
    }
    break;
  }

  return { family: tokens.join(' ') || base, weight, italic };
}

/**
 * Append-or-replace by family, case-insensitively, preserving array order.
 * Mirrors FontRegistry's own index semantics, where the last write wins.
 */
export function upsertFontRegistryEntry(
  registry: FontRegistryEntry[] | undefined,
  entry: FontRegistryEntry
): FontRegistryEntry[] {
  const list = Array.isArray(registry) ? [...registry] : [];
  const at = list.findIndex(
    (e) => e?.family?.toLowerCase() === entry.family.toLowerCase()
  );
  if (at >= 0) list[at] = entry;
  else list.push(entry);
  return list;
}

/**
 * The single (weight, italic) slot a source occupies, or null when it holds
 * no slot of its own.
 *
 * `safe` carries no weight at all and `google` carries a whole `weights`
 * array for the family, so neither can be superseded by one uploaded face —
 * defaulting them to 400/roman would let a single upload silently delete a
 * family-wide Google source. Every other kind (`data`, `file`, `url`,
 * `variable`) names exactly one variant, defaulting to regular roman.
 */
function sourceSlot(s: FontSource): { weight: number; italic: boolean } | null {
  if (s.kind === 'safe' || s.kind === 'google') return null;
  return {
    weight: 'weight' in s && s.weight ? s.weight : 400,
    italic: 'italic' in s ? Boolean(s.italic) : false,
  };
}

/**
 * Merge new data sources into an existing same-family entry, replacing any
 * source with the same (weight, italic) pair so re-uploading a weight
 * overwrites rather than duplicates.
 *
 * The replacement is deliberately kind-blind: a `url`/`file`/`variable`
 * source at the same slot is superseded too. Keeping it would leave the
 * family with two faces competing for one variant, and the winner would be
 * whichever the renderer happened to resolve first — the opposite of the
 * "the upload I just made wins" contract.
 */
export function mergeDataSources(
  existing: FontRegistryEntry | undefined,
  family: string,
  sources: Array<{ data: string; weight: number; italic: boolean }>,
  category?: FontRegistryEntry['category']
): FontRegistryEntry {
  const kept = (existing?.sources ?? []).filter((s) => {
    const slot = sourceSlot(s);
    if (!slot) return true;
    return !sources.some(
      (n) => n.weight === slot.weight && n.italic === slot.italic
    );
  });
  const added = sources.map((s) => ({
    kind: 'data' as const,
    data: s.data,
    weight: s.weight,
    italic: s.italic,
  }));
  const resolvedCategory = category ?? existing?.category;
  return {
    id: existing?.id ?? family,
    family,
    // `category` is optional under additionalProperties:false, so omit it
    // rather than serializing an undefined.
    ...(resolvedCategory ? { category: resolvedCategory } : {}),
    sources: [...kept, ...added],
  };
}

/**
 * Fold several registry entries into one registry array, in one pass.
 *
 * The multi-file upload path needs this: the React hook that writes the
 * registry closes over the store's `documents` snapshot, so calling it once
 * per file would re-parse the same pre-upload text every time and each save
 * would overwrite the previous one — uploading three fonts would keep only
 * the last. Folding here means entry N sees the result of entry N-1, so a
 * second family is appended and a second weight of the *same* family is
 * merged into the entry the first file created.
 *
 * Only `kind:"data"` sources are merged, because that is all the two upload
 * paths ever produce; an entry carrying none is skipped rather than writing
 * a source-less entry (`sources` has minItems:1 in the schema).
 */
export function mergeFontEntriesIntoRegistry(
  registry: FontRegistryEntry[] | undefined,
  entries: FontRegistryEntry[]
): FontRegistryEntry[] {
  let out = Array.isArray(registry) ? [...registry] : [];
  for (const entry of entries) {
    const dataSources = entry.sources
      .filter((s): s is Extract<FontSource, { kind: 'data' }> => {
        return s.kind === 'data';
      })
      .map((s) => ({
        data: s.data,
        weight: s.weight ?? 400,
        italic: s.italic ?? false,
      }));
    if (dataSources.length === 0) continue;
    const existing = out.find(
      (e) => e?.family?.toLowerCase() === entry.family.toLowerCase()
    );
    out = upsertFontRegistryEntry(
      out,
      mergeDataSources(existing, entry.family, dataSources, entry.category)
    );
  }
  return out;
}

/** Response shape of POST /api/fonts/materialize. */
export interface MaterializeResponse {
  family: string;
  sources: Array<{
    weight: number;
    italic: boolean;
    format: string;
    data: string;
  }>;
  warnings: string[];
}

/**
 * Convert a materialize response into a registry entry.
 *
 * Returns null when nothing embeddable came back — FontRegistryEntrySchema
 * declares `sources` with minItems 1, so an empty entry would be invalid and
 * the caller must surface `warnings` as the error instead.
 */
export function materializeResponseToEntry(
  res: MaterializeResponse,
  category?: FontRegistryEntry['category']
): FontRegistryEntry | null {
  const sources = (res.sources ?? [])
    .filter((s) => s.format === 'ttf' || s.format === 'otf')
    .map((s) => ({
      kind: 'data' as const,
      data: s.data,
      weight: s.weight,
      italic: s.italic,
    }));
  if (sources.length === 0) return null;
  return {
    id: res.family,
    family: res.family,
    ...(category ? { category } : {}),
    sources,
  };
}

/**
 * Guard the serialized document against the server's body limit. Returns an
 * error message, or null when the document still fits.
 */
export function checkDocumentSize(json: string): string | null {
  const bytes = new TextEncoder().encode(json).length;
  if (bytes <= MAX_DOCUMENT_JSON_BYTES) return null;
  return `Adding this font would push the document to ${formatBytes(
    bytes
  )}, past the ${formatBytes(
    MAX_DOCUMENT_JSON_BYTES
  )} limit. Remove a font from props.fontRegistry, or use fewer weights.`;
}
