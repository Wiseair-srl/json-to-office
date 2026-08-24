/**
 * Access to the `@json-to-office/jto-ops` format adapters.
 *
 * The adapters themselves import their core on demand, so constructing one is
 * cheap; memoizing is about identity rather than cost — the DOCX adapter keeps
 * per-instance caches (theme resolution, visual pre-pass counters) that a
 * fresh instance per tool call would throw away every request.
 */

import {
  DocxFormatAdapter,
  PptxFormatAdapter,
  type FormatAdapter,
  type FormatName,
} from '@json-to-office/jto-ops';

import { OPTION_ERROR_CODES, failure, type Failure } from './errors.js';

export type { FormatAdapter, FormatName };
export type {
  GeneratorOptions,
  GeneratorResult,
} from '@json-to-office/jto-ops';

const cache = new Map<FormatName, FormatAdapter>();

/** The adapter for `format`, constructed on first use and reused after. */
export function getAdapter(format: FormatName): FormatAdapter {
  let adapter = cache.get(format);
  if (!adapter) {
    adapter =
      format === 'docx' ? new DocxFormatAdapter() : new PptxFormatAdapter();
    cache.set(format, adapter);
  }
  return adapter;
}

/** Drop the memoized adapters. Tests use this to isolate their caches. */
export function resetAdapters(): void {
  cache.clear();
}

/**
 * Reject an unknown renderer before any work happens.
 *
 * The ids come from the core's own registry, so this can never advertise a
 * stale set — same check `jto generate` makes, for the same reason: a typo
 * should cost a message, not a full render followed by one.
 */
export async function checkRenderer(
  adapter: FormatAdapter,
  renderer: string | undefined
): Promise<Failure | undefined> {
  if (renderer === undefined) return undefined;
  const known = await adapter.rendererIds();
  if (known.includes(renderer)) return undefined;
  return failure(
    OPTION_ERROR_CODES.UNKNOWN_RENDERER,
    `Unknown ${adapter.name} renderer "${renderer}".`,
    {
      suggestion: `Use one of: ${known.map((id) => `"${id}"`).join(', ')}.`,
      context: { format: adapter.name, rendererIds: [...known] },
    }
  );
}

/**
 * The document as the requested renderer profile sees it.
 *
 * Both formats discriminate their schema on the document's own top-level
 * `renderer`, so asking "does this validate as office-open?" means validating
 * a copy that says so. A copy, not a mutation: the caller's tree — which may
 * be a workspace document — must come back unchanged.
 */
export function withRenderer(
  document: unknown,
  renderer: string | undefined
): unknown {
  if (renderer === undefined) return document;
  if (
    typeof document !== 'object' ||
    document === null ||
    Array.isArray(document)
  ) {
    return document;
  }
  return { ...(document as Record<string, unknown>), renderer };
}
