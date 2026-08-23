/**
 * prerasterizeVisuals — per-document visual rasterization pre-pass (#153).
 *
 * The renderer walks components strictly in order, so each `visual` used to
 * await its own rasterization round trip: one HTTP call + one LibreOffice
 * launch per visual, ~25 of each for the bundled annual-report templates.
 * This pass runs once per document before rendering: it collects every
 * enabled visual, dedupes identical ones, and rasterizes them together —
 * through an in-process batch rasterizer, a batched HTTP call, or (failing
 * both) bounded-concurrency per-visual calls.
 *
 * Results land in a map keyed by `visualRasterKey`; `renderVisualComponent`
 * consults the map first and falls back to per-visual rasterization on any
 * miss. The pre-pass is therefore purely an accelerator: over-collection
 * wastes a little work, under-collection and every failure mode degrade to
 * the sequential status quo, never to a broken render.
 */

import {
  clampVisualDpi,
  DEFAULT_VISUAL_DPI,
  MAX_RASTERIZE_BATCH_SLIDES,
  type PptxServiceConfig,
  type PptxRasterizeBatchResult,
  type PptxRasterizeBatchSlideResult,
  type RasterizeFontFace,
} from '@json-to-office/shared';
import type { VisualProps } from '@json-to-office/shared-docx';
import {
  buildVisualPresentation,
  effectiveVisualServerUrl,
  rasterizeVisualSlide,
  visualRasterKey,
  DEFAULT_RASTERIZE_SERVER_URL,
} from '../components/visual';
import { isNodeEnvironment } from '../utils/environment';
import { createLimiter } from '../utils/promiseLimiter';
import { resolveServiceUrl, postJsonToService } from '../utils/serviceClient';

/** Bounded concurrency for per-visual fallback rasterizations. */
const DEFAULT_FALLBACK_CONCURRENCY = 4;
/** HTTP timeout for a batch call scales with its slide count. */
const BATCH_TIMEOUT_BASE_MS = 30000;
const BATCH_TIMEOUT_PER_SLIDE_MS = 10000;

export interface PrerasterizeOptions {
  /** Directory relative asset paths resolve against (#142). */
  baseDir?: string;
  /** Max concurrent per-visual fallback rasterizations (default 4). */
  concurrency?: number;
  /**
   * Font faces staged for every slide's LibreOffice render. Request-level,
   * like `baseDir` — never per-slide: the batch schema validates each slide
   * object with `additionalProperties: false`, and a uniform slide shape is
   * what lets the server share one disk-cache key with the single path.
   */
  fonts?: readonly RasterizeFontFace[];
}

/** Cumulative pre-pass counters for visual-work observability (#156). */
export interface VisualPrepassStats {
  /** Documents that entered the pre-pass with at least one visual. */
  documents: number;
  /** Enabled visuals collected across those documents. */
  collected: number;
  /** Unique rasterization units after dedupe (identical content+dpi). */
  unique: number;
}

const prepassStats: VisualPrepassStats = {
  documents: 0,
  collected: 0,
  unique: 0,
};

/**
 * Get cumulative per-document pre-pass counters. `collected - unique` is the
 * work saved by batch-internal deduplication.
 */
export function getVisualPrepassStats(): VisualPrepassStats {
  return { ...prepassStats };
}

export function resetVisualPrepassStats(): void {
  prepassStats.documents = 0;
  prepassStats.collected = 0;
  prepassStats.unique = 0;
}

/** One unique rasterization unit collected from the document. */
interface VisualRasterTarget {
  key: string;
  presentation: Record<string, unknown>;
  dpi: number;
}

/**
 * Result of one batch attempt. `schemaRejected` distinguishes "the server
 * refused this body" (HTTP 400) from every other failure, so the caller can
 * tell a version-skew rejection from a blip instead of treating both alike.
 */
type BatchOutcome =
  | { applied: true }
  | { applied: false; schemaRejected: boolean };

/**
 * Collect the props of every enabled `visual` component reachable from
 * `root`. The walk is generic — every array element and object value is
 * visited — so visuals nested anywhere (columns, table cells, section
 * headers/footers, plugin containers) are found without enumerating
 * container shapes. Disabled component subtrees are pruned: they never
 * render, so rasterizing them is wasted work. Over-collection is harmless
 * (an unused map entry); under-collection is harmless (render-time
 * fallback) — which is what makes the generic walk safe.
 */
export function collectVisualProps(root: unknown): VisualProps[] {
  const found: VisualProps[] = [];
  // Guards against cyclic inputs (the walk accepts arbitrary objects, not
  // just parsed JSON); registered before the array branch so
  // self-referential arrays are covered too.
  const seen = new WeakSet<object>();
  const visit = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    if (seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    const obj = node as Record<string, unknown>;
    // Only component-shaped nodes carry `enabled`; a disabled subtree never
    // renders (mirrors the render-time filters).
    if (typeof obj.name === 'string' && obj.enabled === false) return;
    if (obj.name === 'visual' && obj.props && typeof obj.props === 'object') {
      found.push(obj.props as VisualProps);
      // A visual's elements are a pptx subtree; nothing docx-renderable
      // (and no further docx visuals) can nest inside it.
      return;
    }
    for (const value of Object.values(obj)) visit(value);
  };
  visit(root);
  return found;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * COUPLING: `postJsonToService` (utils/serviceClient.ts) is the only producer
 * of the errors this inspects, and it encodes a non-2xx as
 * `"<serviceLabel> returned <status>: <statusText>"`. This pattern is the one
 * place that knowledge lives; if that message format changes, change it here
 * too (a transport error or timeout carries no status and matches nothing).
 */
const HTTP_STATUS_IN_MESSAGE = /\breturned (\d{3})\b/;

/**
 * Is this failure the server rejecting our request *body* (HTTP 400) rather
 * than the server being unwell? Both rasterize schemas validate with
 * `additionalProperties: false`, so a pre-fonts render server answers a
 * `fonts`-bearing body with a hard 400 — that, and only that, is evidence
 * that dropping `fonts` could help. A timeout, a connection reset or a 5xx
 * says nothing about the body: retrying without fonts cannot fix a server
 * that is down, and must never latch the fontless downgrade.
 */
function isSchemaRejection(error: unknown): boolean {
  const match = HTTP_STATUS_IN_MESSAGE.exec(toErrorMessage(error));
  return match !== null && match[1] === '400';
}

function* chunksOf<T>(items: T[], size: number): Generator<T[]> {
  for (let i = 0; i < items.length; i += size) yield items.slice(i, i + size);
}

/**
 * Validate a batch response and seed the map. All-or-nothing per chunk: any
 * malformed entry rejects the whole chunk (returns false) so a drifted or
 * broken server can never half-seed the map — the caller falls back to
 * per-visual calls instead.
 */
function applyBatchResponse(
  chunk: VisualRasterTarget[],
  response: unknown,
  map: Map<string, PptxRasterizeBatchSlideResult>
): boolean {
  const results = (response as PptxRasterizeBatchResult | undefined)?.results;
  if (!Array.isArray(results) || results.length !== chunk.length) return false;

  const entries: Array<[string, PptxRasterizeBatchSlideResult]> = [];
  for (let i = 0; i < chunk.length; i++) {
    const item = results[i] as PptxRasterizeBatchSlideResult | undefined;
    if (
      item &&
      item.ok === true &&
      typeof item.base64DataUri === 'string' &&
      item.base64DataUri.length > 0 &&
      typeof item.width === 'number' &&
      typeof item.height === 'number'
    ) {
      entries.push([
        chunk[i].key,
        {
          ok: true,
          base64DataUri: item.base64DataUri,
          width: item.width,
          height: item.height,
        },
      ]);
    } else if (item && item.ok === false && typeof item.error === 'string') {
      entries.push([chunk[i].key, { ok: false, error: item.error }]);
    } else {
      return false;
    }
  }
  for (const [key, value] of entries) map.set(key, value);
  return true;
}

/**
 * Batch-rasterize a document's visuals ahead of rendering. Returns a map of
 * `visualRasterKey` → per-visual result (pixels or a recorded error). Never
 * throws for per-visual problems; a thrown error here indicates a pre-pass
 * bug and the caller should continue without the map.
 */
export async function prerasterizeVisuals(
  root: unknown,
  serviceConfig: PptxServiceConfig | undefined,
  options: PrerasterizeOptions = {}
): Promise<Map<string, PptxRasterizeBatchSlideResult>> {
  const map = new Map<string, PptxRasterizeBatchSlideResult>();
  // Injected in-process rasterizers are environment-agnostic; only the HTTP
  // strategy needs Node. In a browser without callbacks the render-time path
  // reports the environment error with full context.
  if (
    !isNodeEnvironment() &&
    !serviceConfig?.renderBatch &&
    !serviceConfig?.render
  ) {
    return map;
  }

  const visuals = collectVisualProps(root);
  if (visuals.length === 0) return map;

  // Dedupe identical visuals: one rasterization per unique (content, dpi).
  const targets = new Map<string, VisualRasterTarget>();
  for (const props of visuals) {
    // The generic walk can reach visual-shaped nodes the renderer never
    // touches; a malformed one must not cost the document its batching.
    // Skipped visuals fall back to the render-time path, which reports the
    // error only if the node actually renders.
    try {
      const serverUrl = effectiveVisualServerUrl(props, serviceConfig);
      // A per-visual HTTP serverUrl override targets a different service than
      // the batch would; leave those to the per-visual render-time path.
      if (serverUrl !== undefined) continue;
      const presentation = buildVisualPresentation(props);
      const dpi = clampVisualDpi(
        props.dpi ?? serviceConfig?.dpi ?? DEFAULT_VISUAL_DPI
      );
      const key = visualRasterKey(presentation, dpi, serverUrl);
      if (!targets.has(key)) targets.set(key, { key, presentation, dpi });
    } catch {
      continue;
    }
  }
  if (targets.size === 0) return map;

  prepassStats.documents++;
  prepassStats.collected += visuals.length;
  prepassStats.unique += targets.size;

  const unique = [...targets.values()];
  const limit = createLimiter(
    Math.max(1, options.concurrency ?? DEFAULT_FALLBACK_CONCURRENCY)
  );

  // Version skew guard. Both rasterize schemas validate with
  // `additionalProperties: false`, so a pre-fonts render server answers a
  // `fonts`-bearing body with a hard 400 instead of ignoring the field. Once
  // a fontless retry has proven that the field was the problem, stop sending
  // it for the rest of the document: fontless pixels beat a failed render.
  // Only a 400 latches this (see isSchemaRejection) — a blip must not
  // silently downgrade every remaining visual to fontless rendering.
  let fontsRejected = false;
  const requestFonts = (): readonly RasterizeFontFace[] | undefined =>
    fontsRejected || !options.fonts?.length ? undefined : options.fonts;

  /**
   * One visual through exactly the render-time code path, with the same
   * version-skew guard the batch path has: `/rasterize` is
   * `additionalProperties: false` too, so an old server 400s a fonts-bearing
   * per-visual body and, without this retry, a failed batch would take the
   * whole document down instead of degrading to fontless visuals.
   */
  const rasterizeOne = async (
    target: VisualRasterTarget
  ): Promise<PptxRasterizeBatchSlideResult> => {
    const fonts = requestFonts();
    const call = (
      withFonts: readonly RasterizeFontFace[] | undefined
    ): Promise<{ base64DataUri: string; width: number; height: number }> =>
      rasterizeVisualSlide(
        target.presentation,
        target.dpi,
        undefined,
        serviceConfig,
        options.baseDir,
        withFonts
      );
    try {
      return { ok: true, ...(await call(fonts)) };
    } catch (error) {
      if (!fonts || !isSchemaRejection(error)) {
        return { ok: false, error: toErrorMessage(error) };
      }
      try {
        const result = await call(undefined);
        // Dropping `fonts` fixed it: the server predates the field.
        fontsRejected = true;
        return { ok: true, ...result };
      } catch {
        // The fontless retry is speculative; when it fails too the fonts were
        // not the problem, so report the original failure and do not latch.
        return { ok: false, error: toErrorMessage(error) };
      }
    }
  };

  /** Per-visual fallback: exactly the render-time code path, bounded. */
  const rasterizeIndividually = async (
    chunk: VisualRasterTarget[]
  ): Promise<void> => {
    await Promise.all(
      chunk.map((target) =>
        limit(async () => {
          map.set(target.key, await rasterizeOne(target));
        })
      )
    );
  };

  // Strategy 1: in-process batch rasterizer.
  if (serviceConfig?.renderBatch) {
    for (const chunk of chunksOf(unique, MAX_RASTERIZE_BATCH_SLIDES)) {
      try {
        const response = await serviceConfig.renderBatch({
          slides: chunk.map((target) => ({
            presentation: target.presentation,
            dpi: target.dpi,
          })),
          ...(options.baseDir !== undefined && { baseDir: options.baseDir }),
          ...(options.fonts?.length ? { fonts: [...options.fonts] } : {}),
        });
        if (!applyBatchResponse(chunk, response, map)) {
          throw new Error(
            'batch rasterizer returned a malformed result (expected index-aligned results[])'
          );
        }
      } catch (error) {
        // Any per-visual route keeps the document building: `render` first,
        // else the configured HTTP server (rasterizeVisualSlide handles both).
        // Only a renderBatch-with-nothing-else config records the batch-level
        // error per visual — there is genuinely nowhere to fall back to, and
        // inventing an HTTP call to the default localhost would replace the
        // real error with a misleading "unreachable" one.
        if (serviceConfig.render || serviceConfig.serverUrl) {
          await rasterizeIndividually(chunk);
        } else {
          const message = toErrorMessage(error);
          for (const target of chunk) {
            map.set(target.key, { ok: false, error: message });
          }
        }
      }
    }
    return map;
  }

  // Strategy 2: in-process single rasterizer — no batch surface, but the
  // pre-pass still parallelizes what the sequential renderer could not.
  if (serviceConfig?.render) {
    await rasterizeIndividually(unique);
    return map;
  }

  // Strategy 3: HTTP. Try the additive batch endpoint; ANY failure — an
  // older server without /rasterize/batch, a transport error, a malformed
  // response — falls back to per-visual calls (the status quo protocol).
  const serverUrl = resolveServiceUrl(
    undefined,
    serviceConfig?.serverUrl,
    DEFAULT_RASTERIZE_SERVER_URL
  );
  const postBatch = async (
    chunk: VisualRasterTarget[],
    fonts: readonly RasterizeFontFace[] | undefined
  ): Promise<BatchOutcome> => {
    let response: Response;
    try {
      response = await postJsonToService({
        url: serverUrl,
        path: '/rasterize/batch',
        body: {
          slides: chunk.map((target) => ({
            presentation: target.presentation,
            dpi: target.dpi,
          })),
          ...(options.baseDir !== undefined && { baseDir: options.baseDir }),
          ...(fonts?.length ? { fonts } : {}),
        },
        headers: serviceConfig?.headers,
        timeoutMs:
          BATCH_TIMEOUT_BASE_MS + BATCH_TIMEOUT_PER_SLIDE_MS * chunk.length,
        serviceLabel: 'PPTX batch rasterization service',
        onUnreachable: (url, cause) =>
          `PPTX rasterization service is not reachable at ${url}. Cause: ${cause}`,
      });
    } catch (error) {
      // A 400 means the server rejected the body we sent; anything else
      // (timeout, reset, 5xx) is the server, not the body.
      return { applied: false, schemaRejected: isSchemaRejection(error) };
    }
    try {
      if (applyBatchResponse(chunk, await response.json(), map)) {
        return { applied: true };
      }
    } catch {
      // Non-JSON body from a 2xx — malformed, not a schema rejection.
    }
    return { applied: false, schemaRejected: false };
  };

  for (const chunk of chunksOf(unique, MAX_RASTERIZE_BATCH_SLIDES)) {
    const fonts = requestFonts();
    let outcome = await postBatch(chunk, fonts);
    if (!outcome.applied && fonts && outcome.schemaRejected) {
      // A pre-fonts render server rejects the whole body with 400 rather
      // than ignoring the unknown field, and the usual batch→per-visual
      // fallback does not help because /rasterize rejects it identically.
      // Retry once without fonts; only latch `fontsRejected` when dropping
      // them actually fixed it, so a transient failure does not cost the rest
      // of the document its font fidelity. A non-400 failure skips the retry
      // entirely: dropping fonts cannot revive a server that is down.
      const retry = await postBatch(chunk, undefined);
      if (retry.applied) {
        fontsRejected = true;
        outcome = retry;
      }
    }
    if (!outcome.applied) await rasterizeIndividually(chunk);
  }
  return map;
}
