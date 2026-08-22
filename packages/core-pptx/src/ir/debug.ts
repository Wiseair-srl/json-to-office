/**
 * Stable debug snapshots of PptxIR.
 *
 * A snapshot is the IR with every binary resource replaced by its content hash
 * and byte length, and object keys emitted in a fixed order. That makes it
 * diffable in a test and readable in a bug report, without base64-inflating
 * megabytes of image data into the snapshot file.
 *
 * The transform is lossless for everything a reviewer cares about and lossy
 * only for bytes, which are identified by hash instead.
 */

import type { PptxIR, PptxIrResource } from './types';

/** A JSON-safe view of the IR, suitable for `toMatchSnapshot`. */
export type PptxIrSnapshot = Record<string, unknown>;

export function snapshotPptxIr(ir: PptxIR): PptxIrSnapshot {
  return sortKeys({
    ...ir,
    resources: ir.resources.map(snapshotResource),
  }) as PptxIrSnapshot;
}

/** Render a snapshot as stable, pretty-printed JSON. */
export function formatPptxIr(ir: PptxIR): string {
  return `${JSON.stringify(snapshotPptxIr(ir), null, 2)}\n`;
}

function snapshotResource(resource: PptxIrResource): Record<string, unknown> {
  const { origin } = resource;
  if (origin.kind !== 'inline') return { ...resource };
  return {
    ...resource,
    origin: {
      kind: 'inline',
      byteLength: origin.byteLength,
      sha256: origin.sha256,
    },
  };
}

/**
 * Recursively sort object keys.
 *
 * Array order is meaningful in the IR (slide order, element z-order, run
 * order) and is preserved; only object key order — which is not — is
 * normalised, so an unrelated change to construction order cannot churn a
 * snapshot.
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
