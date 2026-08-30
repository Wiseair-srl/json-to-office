import { promises as fs } from 'node:fs';
import path from 'node:path';

/**
 * Inline relative media references of a server-discovered document as data
 * URLs, so bundled templates survive safe-mode outbound-source validation and
 * remote rasterization (which runs on a host without the template's files).
 *
 * Covers image paths and `fontRegistry` `kind:'file'` sources — together the
 * shapes safe-mode validation rejects as local reads. Only relative paths that
 * canonicalize inside `baseDir` are inlined; anything else (absolute paths,
 * URLs, data URLs, `..` escapes, missing or oversized files) is left untouched
 * for the outbound-source policy to judge.
 */

const IMAGE_MIME_BY_EXTENSION: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.tiff': 'image/tiff',
  '.tif': 'image/tiff',
};

// `loadDataFontSource` accepts a base64 data URL and magic-byte checks the
// payload, so a mislabeled file fails font resolution with a warning instead
// of slipping past the policy layer.
const FONT_MIME_BY_EXTENSION: Record<string, string> = {
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isInlineCandidate(source: string): boolean {
  if (!source || source.includes('\0')) return false;
  if (source.startsWith('data:')) return false;
  if (path.isAbsolute(source)) return false;
  try {
    new URL(source);
    return false; // absolute URL — policy handles it
  } catch {
    return true;
  }
}

export interface InlineTemplateMediaOptions {
  /** Per-file size cap in bytes; larger files are left as-is. */
  maxFileBytes?: number;
  /** Total inlined bytes cap; once exceeded, remaining files are left as-is. */
  maxTotalBytes?: number;
}

interface InlineState {
  baseDirReal: string;
  maxFileBytes: number;
  totalBudget: number;
  cache: Map<string, string | null>;
}

async function toDataUrl(
  source: string,
  baseDir: string,
  state: InlineState,
  mimeByExtension: Record<string, string>
): Promise<string | null> {
  // Extension gate first, before the cache: the cached verdict for a path
  // must not depend on which MIME table asked (an .otf referenced as an image
  // is not inlineable, but the same file as a font source is).
  const mime = mimeByExtension[path.extname(source).toLowerCase()];
  if (!mime) return null;
  // Key the cache by canonical path so equivalent spellings of the same file
  // (`media/logo.png` vs `media/./logo.png`) share one budget charge.
  let cacheKey = source;
  let result: string | null = null;
  try {
    const resolved = await fs.realpath(path.resolve(baseDir, source));
    cacheKey = resolved;
    const cached = state.cache.get(cacheKey);
    if (cached !== undefined) return cached;
    const contained =
      resolved === state.baseDirReal ||
      resolved.startsWith(state.baseDirReal + path.sep);
    if (contained) {
      const stat = await fs.stat(resolved);
      if (
        stat.isFile() &&
        stat.size <= state.maxFileBytes &&
        stat.size <= state.totalBudget
      ) {
        const buffer = await fs.readFile(resolved);
        state.totalBudget -= buffer.length;
        result = `data:${mime};base64,${buffer.toString('base64')}`;
      }
    }
  } catch {
    // Missing or unreadable file: leave the reference for the policy layer,
    // whose error message names the offending JSON path.
  }
  state.cache.set(cacheKey, result);
  return result;
}

async function visit(
  value: unknown,
  containerKey: string | undefined,
  baseDir: string,
  state: InlineState,
  seen: WeakSet<object>
): Promise<void> {
  if (!value || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);

  if (Array.isArray(value)) {
    for (const entry of value) {
      await visit(entry, containerKey, baseDir, state, seen);
    }
    return;
  }

  const record = value as JsonRecord;

  // Font sources: { kind: 'file', path } is exactly the shape safe-mode
  // validation rejects wherever it appears (fontRegistry is the only schema
  // that uses it). Rewriting to { kind: 'data' } keeps a bundled template
  // generable over HTTP and carries its fonts to the remote rasterizer.
  if (
    record.kind === 'file' &&
    typeof record.path === 'string' &&
    isInlineCandidate(record.path)
  ) {
    const inlined = await toDataUrl(
      record.path,
      baseDir,
      state,
      FONT_MIME_BY_EXTENSION
    );
    if (inlined !== null) {
      record.kind = 'data';
      record.data = inlined;
      // DataFontSourceSchema is additionalProperties:false — a leftover
      // `path` would fail structural validation downstream.
      delete record.path;
    }
  }

  // Image components: { name: 'image', props: { path } }.
  const componentName =
    typeof record.name === 'string' ? record.name.toLowerCase() : undefined;
  const props = isRecord(record.props) ? record.props : undefined;
  if (
    componentName === 'image' &&
    props &&
    typeof props.path === 'string' &&
    isInlineCandidate(props.path)
  ) {
    const inlined = await toDataUrl(
      props.path,
      baseDir,
      state,
      IMAGE_MIME_BY_EXTENSION
    );
    if (inlined !== null) props.path = inlined;
  }

  // Canvas/slide backgrounds: plain { image: { path } } objects.
  if (
    containerKey === 'image' &&
    typeof record.path === 'string' &&
    isInlineCandidate(record.path)
  ) {
    const inlined = await toDataUrl(
      record.path,
      baseDir,
      state,
      IMAGE_MIME_BY_EXTENSION
    );
    if (inlined !== null) record.path = inlined;
  }

  for (const [key, child] of Object.entries(record)) {
    await visit(child, key, baseDir, state, seen);
  }
}

export async function inlineTemplateMedia(
  jsonDefinition: unknown,
  baseDir: string,
  options: InlineTemplateMediaOptions = {}
): Promise<unknown> {
  // The generation schema also accepts a JSON string definition; parse it so
  // its media inlines too (the generator accepts either form downstream).
  if (typeof jsonDefinition === 'string') {
    try {
      jsonDefinition = JSON.parse(jsonDefinition);
    } catch {
      // Structural validation owns malformed JSON reporting.
      return jsonDefinition;
    }
  }
  if (!jsonDefinition || typeof jsonDefinition !== 'object') {
    return jsonDefinition;
  }

  let baseDirReal: string;
  try {
    baseDirReal = await fs.realpath(baseDir);
  } catch {
    return jsonDefinition;
  }

  const clone = structuredClone(jsonDefinition);
  const state: InlineState = {
    baseDirReal,
    maxFileBytes: options.maxFileBytes ?? 10 * 1024 * 1024,
    totalBudget: options.maxTotalBytes ?? 32 * 1024 * 1024,
    cache: new Map(),
  };
  await visit(clone, undefined, baseDir, state, new WeakSet());
  return clone;
}
