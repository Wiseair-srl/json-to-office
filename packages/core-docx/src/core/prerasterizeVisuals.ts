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
}

/** Cumulative pre-pass counters for cache observability (#156). */
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
 * work the dedupe saved — the `visual` cache benefit the component cache
 * stats can never show, since `visual` bypasses that cache by design.
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

  /** Per-visual fallback: exactly the render-time code path, bounded. */
  const rasterizeIndividually = async (
    chunk: VisualRasterTarget[]
  ): Promise<void> => {
    await Promise.all(
      chunk.map((target) =>
        limit(async () => {
          try {
            const result = await rasterizeVisualSlide(
              target.presentation,
              target.dpi,
              undefined,
              serviceConfig,
              options.baseDir
            );
            map.set(target.key, { ok: true, ...result });
          } catch (error) {
            map.set(target.key, { ok: false, error: toErrorMessage(error) });
          }
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
  for (const chunk of chunksOf(unique, MAX_RASTERIZE_BATCH_SLIDES)) {
    let applied = false;
    try {
      const response = await postJsonToService({
        url: serverUrl,
        path: '/rasterize/batch',
        body: {
          slides: chunk.map((target) => ({
            presentation: target.presentation,
            dpi: target.dpi,
          })),
          ...(options.baseDir !== undefined && { baseDir: options.baseDir }),
        },
        headers: serviceConfig?.headers,
        timeoutMs:
          BATCH_TIMEOUT_BASE_MS + BATCH_TIMEOUT_PER_SLIDE_MS * chunk.length,
        serviceLabel: 'PPTX batch rasterization service',
        onUnreachable: (url, cause) =>
          `PPTX rasterization service is not reachable at ${url}. Cause: ${cause}`,
      });
      applied = applyBatchResponse(chunk, await response.json(), map);
    } catch {
      applied = false;
    }
    if (!applied) await rasterizeIndividually(chunk);
  }
  return map;
}
