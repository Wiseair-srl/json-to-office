/**
 * Cache Configuration
 * Default configuration and environment-based configuration
 */

import { CacheConfiguration } from './types';

/**
 * Default cache configuration
 */
export const DEFAULT_CACHE_CONFIG: CacheConfiguration = {
  enabled: true,
  memory: {
    enabled: true,
    maxSize: 100, // 100MB
    maxEntries: 1000,
    defaultTTL: 3600, // 1 hour
    cleanupInterval: 300, // 5 minutes
  },
  evictionPolicy: 'lru',
  componentConfig: {
    // Static content - longer TTL
    text: { cacheable: true, ttl: 7200 }, // 2 hours
    heading: { cacheable: true, ttl: 7200 },
    columns: { cacheable: true, ttl: 3600 }, // 1 hour
    section: { cacheable: true, ttl: 3600 },

    // Dynamic content - shorter TTL
    'custom-data': { cacheable: true, ttl: 300 }, // 5 minutes
    'api-content': { cacheable: true, ttl: 180 }, // 3 minutes

    // Resource-intensive components - medium TTL
    image: { cacheable: true, ttl: 1800 }, // 30 minutes
    table: { cacheable: true, ttl: 1800 },
  },
  performance: {
    trackMetrics: true,
    metricsSampleRate: 1.0,
    enableWarming: false,
    parallelProcessing: true,
  },
};

/**
 * Get cache configuration from environment variables
 */
export function getCacheConfigFromEnv(): Partial<CacheConfiguration> {
  const config: Partial<CacheConfiguration> = {};

  // Global enabled flag
  if (process.env.CACHE_ENABLED !== undefined) {
    config.enabled = process.env.CACHE_ENABLED !== 'false';
  }

  // Memory cache configuration
  if (
    process.env.CACHE_MAX_SIZE ||
    process.env.CACHE_MAX_ENTRIES ||
    process.env.CACHE_TTL
  ) {
    config.memory = {
      enabled: true,
      maxSize: parseInt(process.env.CACHE_MAX_SIZE || '100'),
      maxEntries: parseInt(process.env.CACHE_MAX_ENTRIES || '1000'),
      defaultTTL: parseInt(process.env.CACHE_TTL || '3600'),
      cleanupInterval: parseInt(process.env.CACHE_CLEANUP_INTERVAL || '300'),
    };
  }

  // Performance configuration
  if (
    process.env.CACHE_TRACK_METRICS !== undefined ||
    process.env.CACHE_WARMING !== undefined
  ) {
    config.performance = {
      trackMetrics: process.env.CACHE_TRACK_METRICS !== 'false',
      metricsSampleRate: parseFloat(process.env.CACHE_SAMPLE_RATE || '1.0'),
      enableWarming: process.env.CACHE_WARMING === 'true',
      parallelProcessing: process.env.CACHE_PARALLEL !== 'false',
    };
  }

  return config;
}

/**
 * Merge configurations with priority
 */
export function mergeConfigs(
  ...configs: Partial<CacheConfiguration>[]
): CacheConfiguration {
  const merged = { ...DEFAULT_CACHE_CONFIG };

  for (const config of configs) {
    if (config.enabled !== undefined) {
      merged.enabled = config.enabled;
    }

    if (config.memory) {
      merged.memory = { ...merged.memory, ...config.memory };
    }

    if (config.disk) {
      merged.disk = { ...merged.disk, ...config.disk };
    }

    if (config.evictionPolicy) {
      merged.evictionPolicy = config.evictionPolicy;
    }

    if (config.componentConfig) {
      merged.componentConfig = { ...merged.componentConfig, ...config.componentConfig };
    }

    if (config.performance) {
      merged.performance = { ...merged.performance, ...config.performance };
    }
  }

  return merged;
}
