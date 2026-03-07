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
import { createHash } from 'crypto';

// Global component cache instance
let componentCache: MemoryCache | null = null;
let cacheKeyGen: CacheKeyGenerator | null = null;

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
  // Certain components depend on dynamic runtime context and must not be cached.
  // - 'toc' depends on section bookmark IDs generated at render time; caching
  //   can produce stale references to non-existent bookmarks on re-render.
  // - 'section' generates unique bookmarks internally; caching would duplicate
  //   bookmark IDs across sections/documents.
  const forceBypassForType = component.name === 'toc' || component.name === 'section';

  // Initialize cache if needed
  if (!componentCache) {
    initializeComponentCache();
  }

  // If cache is disabled or bypassed, render directly
  if (
    !componentCache ||
    bypassCache ||
    forceBypassForType ||
    !componentCache.getConfig().enabled
  ) {
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

  // For container components (columns, section, etc.), include children in cache key
  // This ensures cache invalidation when child component content changes
  const childrenKey =
    'children' in component && component.children
      ? `:children:${JSON.stringify(component.children)}`
      : '';

  const cacheKey = `component:${component.name}:${themeHash}:${contextKey}:${componentProps}${childrenKey}`;

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
  if (!componentCache || !componentCache.getConfig().performance.enableWarming) {
    return;
  }

  const warmingPromises = components.map(
    async ({ component, theme, themeName, context }) => {
      await renderComponentWithCache(component, theme, themeName, context, false);
    }
  );

  await Promise.all(warmingPromises);
}

/**
 * Get component cache statistics
 */
export function getComponentCacheStats() {
  if (!componentCache) {
    return null;
  }

  return componentCache.getStats();
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
