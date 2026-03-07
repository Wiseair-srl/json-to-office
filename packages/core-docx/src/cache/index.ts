/**
 * Cache Module Exports
 * Main entry point for the caching system
 */

export * from './types';
export * from './manager';
export * from './memory-cache';
export * from './key-generator';
export * from './config';
export * from './analytics';

// Re-export commonly used items for convenience
export { MemoryCache } from './memory-cache';
export { CacheKeyGenerator } from './key-generator';
export {
  DEFAULT_CACHE_CONFIG,
  getCacheConfigFromEnv,
  mergeConfigs,
} from './config';
export { ComponentCacheAnalytics } from './analytics';

// Export types
export type {
  CacheConfiguration,
  CachedComponent,
  CacheStatistics,
  CacheKeyOptions,
  CacheEvents,
} from './types';

export type {
  CacheAnalyticsReport,
  ComponentPerformanceMetrics,
  ComponentCacheTrends,
  CacheOptimizationRecommendation,
  TimeSeriesPoint,
} from './analytics';
