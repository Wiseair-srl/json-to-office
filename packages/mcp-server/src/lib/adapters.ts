/**
 * Access to the `@json-to-office/jto-ops` format adapters.
 *
 * The adapters themselves import their core on demand, so constructing one is
 * cheap; memoizing is about identity rather than cost — the DOCX adapter keeps
 * per-instance caches (theme resolution, visual pre-pass counters) that a
 * fresh instance per tool call would throw away every request.
 */

import type { RendererStatus } from '@json-to-office/shared';
import {
  DocxFormatAdapter,
  PptxFormatAdapter,
  type FormatAdapter,
  type FormatName,
} from '@json-to-office/jto-ops';

import {
  ERROR_CODES,
  OPTION_ERROR_CODES,
  diagnostic,
  failure,
  type Diagnostic,
  type Failure,
} from './errors.js';

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

/**
 * The renderer a document will actually be built with.
 *
 * `undefined` for both the explicit override and the document's own field
 * means the format's default, which is what a render would pick.
 */
function effectiveRenderer(
  document: unknown,
  override: string | undefined
): string | undefined {
  if (override !== undefined) return override;
  if (typeof document === 'object' && document !== null) {
    const declared = (document as { renderer?: unknown }).renderer;
    if (typeof declared === 'string') return declared;
  }
  return undefined;
}

/**
 * Warn when the profile a document validates against cannot actually render.
 *
 * Validation used to return a clean bill of health for a renderer whose backend
 * was not installed — profile findings and all — and the caller only learned
 * otherwise one call later, at the render. That is the worst of both worlds: a
 * green light followed by a failure the green light was supposed to rule out.
 *
 * A warning, not an error. The document may be perfectly good and the host
 * merely incomplete, and which of the two the caller cares about is the
 * caller's business.
 */
export async function rendererAvailability(
  adapter: FormatAdapter,
  document: unknown,
  override: string | undefined
): Promise<Diagnostic | undefined> {
  const wanted = effectiveRenderer(document, override);
  let statuses: readonly RendererStatus[];
  try {
    statuses = await adapter.rendererStatuses();
  } catch {
    // The core would not load at all. Generation will say so far more
    // precisely than a guess from here could.
    return undefined;
  }
  const status = wanted
    ? statuses.find((entry) => entry.id === wanted)
    : statuses.find((entry) => entry.default);
  if (!status || status.available) return undefined;

  const usable = statuses
    .filter((entry) => entry.available)
    .map((entry) => `"${entry.id}"`);
  return diagnostic(
    ERROR_CODES.DEPENDENCY_MISSING,
    `This document validates against the "${status.id}" ${adapter.name} renderer, but that renderer cannot load on this host — generating with it will fail.`,
    {
      severity: 'warning',
      suggestion: status.installHint
        ? `Install its backend: ${status.installHint}.${
            usable.length > 0 ? ` Or render with ${usable.join(' or ')}.` : ''
          }`
        : `Render with ${usable.join(' or ')} instead.`,
      context: {
        format: adapter.name,
        renderer: status.id,
        ...(status.reason && { reason: status.reason }),
      },
    }
  );
}
