/**
 * Stable debug snapshots of DocxIR.
 *
 * A snapshot is the IR with every binary resource replaced by its content hash
 * and byte length, and object keys in a fixed order — diffable in a test,
 * readable in a bug report, and free of the megabytes of image data that a
 * base64 dump would carry.
 */

import type { DocxIR, DocxIrResource } from './types';

/** A JSON-safe view of the IR, suitable for `toMatchSnapshot`. */
export type DocxIrSnapshot = Record<string, unknown>;

export function snapshotDocxIr(ir: DocxIR): DocxIrSnapshot {
  return sortKeys({
    ...ir,
    resources: ir.resources.map(snapshotResource),
  }) as DocxIrSnapshot;
}

/** Render a snapshot as stable, pretty-printed JSON. */
export function formatDocxIr(ir: DocxIR): string {
  return `${JSON.stringify(snapshotDocxIr(ir), null, 2)}\n`;
}

function snapshotResource(resource: DocxIrResource): Record<string, unknown> {
  // The bytes are dropped: `sha256` already identifies them, and a base64 dump
  // would make the snapshot unreadable and enormous.
  const rest: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(resource)) {
    if (key !== 'bytes') rest[key] = value;
  }
  return rest;
}

/**
 * Recursively sort object keys.
 *
 * Array order is meaningful in the IR — section order, block order, run order —
 * and is preserved; only object key order, which is not, is normalised, so an
 * unrelated change to construction order cannot churn a snapshot.
 */
function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value instanceof Uint8Array) {
    return { type: 'Uint8Array', byteLength: value.byteLength };
  }
  if (value === null || typeof value !== 'object') return value;

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  const out: Record<string, unknown> = {};
  for (const [key, v] of entries) out[key] = sortKeys(v);
  return out;
}
