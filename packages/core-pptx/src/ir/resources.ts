/**
 * Resource table used while compiling a presentation to PptxIR.
 *
 * One table per compilation — never module-global — so concurrent generations
 * cannot share ids or entries.
 *
 * Identity depends on where the bytes come from. Inline sources (authored
 * base64, raw SVG) are decoded once and keyed by content hash, so the same
 * image authored twice becomes one resource. File and remote sources keep
 * their location and are keyed by it, because reading every file at compile
 * time would change when I/O happens and how much of a large deck is resident
 * in memory.
 */

import type {
  PptxIrPixelSize,
  PptxIrResource,
  PptxIrResourceOrigin,
} from './types';
import { sha256Hex } from './units';

export interface InlineResourceInput {
  kind: 'inline';
  bytes: Uint8Array;
  mediaType?: string;
}

export interface FileResourceInput {
  kind: 'file';
  path: string;
  mediaType?: string;
}

export interface RemoteResourceInput {
  kind: 'remote';
  url: string;
  mediaType?: string;
}

export type ResourceInput =
  | InlineResourceInput
  | FileResourceInput
  | RemoteResourceInput;

export class ResourceTable {
  private readonly byKey = new Map<string, PptxIrResource>();
  private readonly order: PptxIrResource[] = [];

  /**
   * Add a resource (or return the existing one with matching identity) and
   * return its id.
   */
  intern(input: ResourceInput, intrinsic?: PptxIrPixelSize): string {
    const origin = toOrigin(input);
    const key = identity(origin);
    const existing = this.byKey.get(key);
    if (existing) {
      // A later reference may have probed dimensions the first one skipped.
      if (!existing.intrinsic && intrinsic) existing.intrinsic = intrinsic;
      return existing.id;
    }

    const resource: PptxIrResource = {
      id: `res${this.order.length + 1}`,
      kind: 'image',
      origin,
      ...(input.mediaType ? { mediaType: input.mediaType } : {}),
      ...(intrinsic ? { intrinsic } : {}),
    };
    this.byKey.set(key, resource);
    this.order.push(resource);
    return resource.id;
  }

  /** Every resource, in first-use order. */
  list(): PptxIrResource[] {
    return this.order;
  }

  get(id: string): PptxIrResource | undefined {
    return this.order.find((r) => r.id === id);
  }
}

function toOrigin(input: ResourceInput): PptxIrResourceOrigin {
  switch (input.kind) {
    case 'inline':
      return {
        kind: 'inline',
        bytes: input.bytes,
        byteLength: input.bytes.byteLength,
        sha256: sha256Hex(input.bytes),
      };
    case 'file':
      return { kind: 'file', path: input.path };
    case 'remote':
      return { kind: 'remote', url: input.url };
  }
}

function identity(origin: PptxIrResourceOrigin): string {
  switch (origin.kind) {
    case 'inline':
      return `sha256:${origin.sha256}`;
    case 'file':
      return `file:${origin.path}`;
    case 'remote':
      return `remote:${origin.url}`;
  }
}

/**
 * Split a `data:` URI into its media type and decoded bytes.
 *
 * Returns `undefined` for anything that is not a base64 data URI, so callers
 * can fall back to treating the string as a location.
 */
export function parseDataUri(
  source: string
): { mediaType: string; bytes: Uint8Array } | undefined {
  const match = /^data:([^;,]+)(;[^,]*)?,(.*)$/s.exec(source);
  if (!match) return undefined;
  const [, mediaType, params, payload] = match;
  const isBase64 = (params ?? '').includes(';base64');
  const bytes = isBase64
    ? new Uint8Array(Buffer.from(payload, 'base64'))
    : new Uint8Array(Buffer.from(decodeURIComponent(payload), 'utf-8'));
  return { mediaType, bytes };
}

/** Guess a media type from a file extension or URL path. */
export function mediaTypeFromLocation(location: string): string | undefined {
  const withoutQuery = location.split(/[?#]/)[0];
  const ext = withoutQuery
    .slice(withoutQuery.lastIndexOf('.') + 1)
    .toLowerCase();
  switch (ext) {
    case 'png':
      return 'image/png';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'gif':
      return 'image/gif';
    case 'svg':
      return 'image/svg+xml';
    case 'webp':
      return 'image/webp';
    case 'bmp':
      return 'image/bmp';
    case 'tif':
    case 'tiff':
      return 'image/tiff';
    default:
      return undefined;
  }
}
