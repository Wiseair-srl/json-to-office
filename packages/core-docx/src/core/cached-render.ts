/**
 * Cached component rendering system
 * Provides caching layer for component rendering operations
 */

import { Paragraph, Table, TableOfContents, Textbox } from 'docx';
import { ComponentDefinition, RenderContext } from '../types';
import { ThemeConfig } from '../styles';
import {
  MemoryCache,
  CacheKeyGenerator,
  CacheConfiguration,
  CachedComponent,
} from '../cache';
import { renderComponent } from './render';
import { componentHasRevision } from '../utils/revisionUtils';
import { componentHasAnnotation } from '../utils/componentAnnotations';
import { getBaseDir, getGenerationDate } from '../utils/generationContext';
import { PlaceholderRegistry } from '../utils/placeholderProcessor';
import { createHash } from 'crypto';

// Global component cache instance
let componentCache: MemoryCache | null = null;
let cacheKeyGen: CacheKeyGenerator | null = null;

/** Why a component type is never cached (see renderComponentWithCache). */
export type ComponentBypassReason =
  | 'dynamic-context'
  | 'bookmark-id'
  | 'revision-ids'
  | 'comment-ids';

export interface ComponentBypassStats {
  /** Component type name. */
  type: string;
  /** Renders that skipped the cache by design. */
  renders: number;
  /** The (first observed) reason this type bypasses the cache. */
  reason: ComponentBypassReason;
}

/**
 * Per-type counters for renders that deliberately skip the cache. Without
 * them the Module Breakdown is structurally blind to `toc`, `section`,
 * `visual`, `heading`, `list`, `paragraph`, and id/revision-bearing nodes —
 * they return before any cache.get, so the cache's own stats never see them
 * (#156). Only design bypasses are recorded; a caller's `bypassCache` flag
 * and a disabled cache are per-render choices, not properties of the type.
 */
const bypassStats = new Map<
  string,
  { renders: number; reason: ComponentBypassReason }
>();

function recordBypass(type: string, reason: ComponentBypassReason): void {
  const entry = bypassStats.get(type);
  if (entry) {
    entry.renders++;
  } else {
    bypassStats.set(type, { renders: 1, reason });
  }
}

/**
 * Get per-type "uncached by design" render counters.
 */
export function getComponentBypassStats(): ComponentBypassStats[] {
  return Array.from(bypassStats.entries()).map(([type, s]) => ({
    type,
    renders: s.renders,
    reason: s.reason,
  }));
}

/**
 * Placeholders that resolve from the generation date. `{PAGE}` and
 * `{TOTAL_PAGES}` are Word field codes — date-independent — while every
 * other registered placeholder (DATE, DATETIME, YEAR, custom registrations)
 * may read the date, so their presence keeps the date in the cache key.
 */
const DATE_INDEPENDENT_PLACEHOLDERS = new Set(['PAGE', 'TOTAL_PAGES']);

/**
 * True when the serialized props/children reference a registered placeholder
 * whose output can vary with the generation date. Components without one
 * render identically across dates, so their cache keys must not embed the
 * per-render timestamp — that's what made cross-render hits impossible for
 * date-less documents (#156).
 */
export function usesDateSensitivePlaceholder(serialized: string): boolean {
  const placeholderRegex = /\{([^}{]+)\}/g;
  let match: RegExpExecArray | null;
  while ((match = placeholderRegex.exec(serialized)) !== null) {
    const name = match[1].toUpperCase();
    if (DATE_INDEPENDENT_PLACEHOLDERS.has(name)) continue;
    if (PlaceholderRegistry.has(name)) return true;
  }
  return false;
}

/**
 * Create a hash of the theme configuration for cache key generation
 * This ensures cache invalidation when theme changes
 */
function createThemeHash(theme: ThemeConfig): string {
  // Serialize the theme object to JSON and create a hash
  const themeString = JSON.stringify(theme);
  return createHash('sha256').update(themeString).digest('hex').substring(0, 8);
}

/**
 * Initialize the component cache
 */
export function initializeComponentCache(cache?: MemoryCache): void {
  if (cache) {
    componentCache = cache;
  } else if (!componentCache) {
    // Create a default cache if none provided
    const config: CacheConfiguration = {
      enabled: true,
      evictionPolicy: 'lru',
      memory: {
        enabled: true,
        maxSize: 100, // 100MB for components
        maxEntries: 1000,
        defaultTTL: 3600, // 1 hour
        cleanupInterval: 300, // 5 minutes
      },
      performance: {
        trackMetrics: true,
        metricsSampleRate: 1.0,
        enableWarming: false,
        parallelProcessing: true,
      },
    };
    componentCache = new MemoryCache(config);
  }

  if (!cacheKeyGen) {
    cacheKeyGen = new CacheKeyGenerator();
  }
}

/**
 * Get the component cache instance
 */
export function getComponentCache(): MemoryCache | null {
  return componentCache;
}

/**
 * Clear the component cache
 */
export async function clearComponentCache(): Promise<void> {
  if (componentCache) {
    await componentCache.clear();
  }
  bypassStats.clear();
}

/**
 * Component types whose render output depends on per-render state that is not
 * part of the cache key.
 *
 * - 'toc' depends on section bookmark ids generated at render time; caching
 *   can produce stale references to non-existent bookmarks on re-render.
 * - 'section' generates document-scoped bookmarks internally; caching would
 *   duplicate bookmark ids across sections.
 * - 'visual' rasterizes via the injected services.pptx (an in-process render
 *   fn or an HTTP serverUrl) which is NOT part of the cache key; caching by
 *   props alone could serve a stale image when the rasterizer differs across
 *   renders. The rasterizer keeps its own content-addressed disk cache, so an
 *   identical visual is still cheap to re-resolve.
 * - 'heading', 'list' and 'paragraph': both explicit lists and markdown-list
 *   paragraphs register numbering in the current document scope. Cached
 *   paragraphs can otherwise reference definitions that only existed in a
 *   previous render.
 */
const DYNAMIC_CONTEXT_COMPONENTS = new Set([
  'toc',
  'section',
  'visual',
  'heading',
  'list',
  'paragraph',
]);

/**
 * Why this component must skip the cross-document component cache, or `null`
 * when it is safe to cache.
 *
 * Kept as one named predicate so a new reason is a new clause here rather
 * than a restructuring of an inline conditional ladder.
 */
export function componentBypassReason(
  component: ComponentDefinition
): ComponentBypassReason | null {
  // Revision-bearing components embed document-scoped w:ins/w:del ids from a
  // per-render counter; caching would leak ids across documents.
  if (componentHasRevision(component)) return 'revision-ids';
  // Comments do the same with their own (separate) id namespace, and a cached
  // anchor would also point at a body that lives in another document.
  if (componentHasAnnotation(component, 'comment')) return 'comment-ids';
  if ('id' in component) return 'bookmark-id';
  if (DYNAMIC_CONTEXT_COMPONENTS.has(component.name)) return 'dynamic-context';
  return null;
}

/**
 * Render a component with caching
 */
export async function renderComponentWithCache(
  component: ComponentDefinition,
  theme: ThemeConfig,
  themeName: string,
  context: RenderContext,
  bypassCache = false
): Promise<(Paragraph | Table | TableOfContents | Textbox)[]> {
  const bypassReason = componentBypassReason(component);

  // Initialize cache if needed
  if (!componentCache) {
    initializeComponentCache();
  }

  // If cache is disabled or bypassed, render directly. Design bypasses are
  // counted so cache observability covers every component type, not only
  // the cacheable ones (#156).
  if (bypassReason !== null) {
    recordBypass(component.name, bypassReason);
    return renderComponent(component, theme, themeName, context);
  }
  if (!componentCache || bypassCache || !componentCache.getConfig().enabled) {
    return renderComponent(component, theme, themeName, context);
  }

  // Generate cache key for this component
  // Use theme hash instead of name to ensure cache invalidation on theme changes
  const componentProps = JSON.stringify(component.props || {});
  const themeHash = createThemeHash(theme);
  // Include minimal context for other components that might vary with context
  // For now we add section layout type and column count without exposing
  // bookmark IDs (TOC/section are bypassed above).
  const contextKey = context?.section
    ? `${context.section.currentLayout}:${context.section.columnCount}`
    : 'no-section';
  // Components that read local assets (images) resolve relative paths against
  // the active baseDir; identical props from different document directories
  // must not share cached bytes (#142).
  const baseDirKey = getBaseDir() ?? '';

  // For container components (columns, section, etc.), include children in cache key
  // This ensures cache invalidation when child component content changes
  const childrenKey =
    'children' in component && component.children
      ? `:children:${JSON.stringify(component.children)}`
      : '';

  // Placeholder resolution is scoped to the document metadata/generatedAt
  // date — but only for components that actually reference a date-sensitive
  // placeholder (anywhere in props or children: dynamic text can hide inside
  // a table cell). Unconditionally embedding the per-render timestamp made
  // every cross-render lookup miss for date-less documents, reducing the
  // cache to an intra-render dedupe (#156).
  const generationDateKey = usesDateSensitivePlaceholder(
    componentProps + childrenKey
  )
    ? getGenerationDate().toISOString()
    : 'no-date';

  const cacheKey = `component:${component.name}:${themeHash}:${contextKey}:${generationDateKey}:${baseDirKey}:${componentProps}${childrenKey}`;

  // Try to get from cache
  const cached = await componentCache.get(cacheKey);

  if (cached) {
    // Cache hit - the cache internally tracks this as a hit
    // Return the rendered result from cache
    return cached.result as (Paragraph | Table | TableOfContents | Textbox)[];
  }

  // Cache miss - render the component
  const renderStartTime = Date.now();
  const rendered = await renderComponent(component, theme, themeName, context);
  // Track render time for analytics
  Date.now() - renderStartTime;

  // Calculate approximate size (rough estimate)
  const componentSize = JSON.stringify(rendered).length;

  // Create a proper CachedComponent structure
  const cachedEntry: CachedComponent = {
    result: rendered as unknown, // Store the rendered Paragraph/Table array as result
    componentName: component.name,
    propsHash: cacheKey,
    timestamp: Date.now(),
    hits: 0,
    size: componentSize,
    dependencies: [],
    signature: cacheKey,
    lastAccessed: Date.now(),
  };

  // Store in cache - the cache internally tracks this as a miss
  await componentCache.set(cacheKey, cachedEntry);

  return rendered;
}

// Note: Component statistics are automatically tracked by the cache itself
// The cache's updateHitStats and updateMissStats methods handle this internally

/**
 * Warm the cache with frequently used components
 */
export async function warmComponentCache(
  components: Array<{
    component: ComponentDefinition;
    theme: ThemeConfig;
    themeName: string;
    context: RenderContext;
  }>
): Promise<void> {
  if (
    !componentCache ||
    !componentCache.getConfig().performance.enableWarming
  ) {
    return;
  }

  const warmingPromises = components.map(
    async ({ component, theme, themeName, context }) => {
      await renderComponentWithCache(
        component,
        theme,
        themeName,
        context,
        false
      );
    }
  );

  await Promise.all(warmingPromises);
}

/**
 * Get component cache statistics, extended with per-type "uncached by
 * design" render counters (#156). The bypass counters exist even before the
 * cache is initialized — a document full of bypassed types never triggers
 * initialization, yet its renders are exactly what needs surfacing.
 */
export function getComponentCacheStats() {
  const bypassedComponents = getComponentBypassStats();
  if (!componentCache) {
    return bypassedComponents.length > 0 ? { bypassedComponents } : null;
  }

  return { ...componentCache.getStats(), bypassedComponents };
}

/**
 * Export component cache for persistence
 */
export async function exportComponentCache(): Promise<Map<
  string,
  unknown
> | null> {
  if (!componentCache) {
    return null;
  }

  const keys = await componentCache.getKeys();
  const exported = new Map<string, unknown>();

  for (const key of keys) {
    const value = await componentCache.get(key);
    if (value) {
      exported.set(key, value);
    }
  }

  return exported;
}

/**
 * Import component cache from persistence
 */
export async function importComponentCache(
  data: Map<string, unknown>
): Promise<void> {
  if (!componentCache) {
    initializeComponentCache();
  }

  for (const [key, value] of data.entries()) {
    await componentCache!.set(key, value as CachedComponent);
  }
}
