/**
 * Cache Types and Interfaces
 * Core type definitions for the component caching system
 */

// ComponentDefinition import removed as it's no longer used after changing CachedComponent.result to unknown

/**
 * Cache entry metadata
 */
export interface CacheMetadata {
  /** Creation timestamp */
  timestamp: number;
  /** Number of cache hits */
  hits: number;
  /** Size in bytes */
  size: number;
  /** Component dependencies */
  dependencies: string[];
  /** Content signature for validation */
  signature: string;
  /** Time-to-live in seconds */
  ttl?: number;
  /** Last access timestamp */
  lastAccessed: number;
}

/**
 * Cached component entry
 */
export interface CachedComponent extends CacheMetadata {
  /** Processed component result */
  result: unknown;
  /** Component name for analytics */
  componentName: string;
  /** Original component props hash */
  propsHash: string;
}

/**
 * Cache statistics
 */
export interface CacheStatistics {
  /** Total number of entries */
  entries: number;
  /** Total cache size in bytes */
  totalSize: number;
  /** Cache hit rate (0-1) */
  hitRate: number;
  /** Cache miss rate (0-1) */
  missRate: number;
  /** Total hits */
  totalHits: number;
  /** Total misses */
  totalMisses: number;
  /** Average response time in ms */
  avgResponseTime: number;
  /** Eviction count */
  evictions: number;
  /** Per-component statistics */
  componentStats: Map<string, ComponentStatistics>;
}

/**
 * Component-specific statistics
 */
export interface ComponentStatistics {
  /** Component name */
  name: string;
  /** Number of cache hits */
  hits: number;
  /** Number of cache misses */
  misses: number;
  /** Average processing time when missed */
  avgProcessTime: number;
  /** Average size of cached entries */
  avgSize: number;
  /** Number of cached entries */
  entries: number;
}

/**
 * Cache key options
 */
export interface CacheKeyOptions {
  /** Include theme in key generation */
  includeTheme?: boolean;
  /** Include render context in key */
  includeContext?: boolean;
  /** Additional key components */
  additionalKeys?: string[];
  /** Key version for cache busting */
  version?: string;
}

/**
 * Cache configuration
 */
export interface CacheConfiguration {
  /** Enable/disable caching globally */
  enabled: boolean;

  /** Memory cache configuration */
  memory: {
    enabled: boolean;
    /** Maximum cache size in MB */
    maxSize: number;
    /** Maximum number of entries */
    maxEntries: number;
    /** Default TTL in seconds */
    defaultTTL: number;
    /** Check expired entries interval in seconds */
    cleanupInterval: number;
  };

  /** Disk cache configuration (future) */
  disk?: {
    enabled: boolean;
    /** Cache directory path */
    path: string;
    /** Maximum cache size in MB */
    maxSize: number;
    /** Default TTL in seconds */
    defaultTTL: number;
    /** Compression enabled */
    compression: boolean;
  };

  /** Eviction policy */
  evictionPolicy: 'lru' | 'lfu' | 'fifo' | 'ttl';

  /** Component-specific configurations */
  componentConfig?: {
    [componentName: string]: {
      /** Whether this component is cacheable */
      cacheable: boolean;
      /** Custom TTL for this component */
      ttl?: number;
      /** Maximum entries for this component */
      maxEntries?: number;
    };
  };

  /** Performance settings */
  performance: {
    /** Enable performance tracking */
    trackMetrics: boolean;
    /** Metrics sampling rate (0-1) */
    metricsSampleRate: number;
    /** Enable cache warming */
    enableWarming: boolean;
    /** Parallel processing for batch operations */
    parallelProcessing: boolean;
  };
}

/**
 * Cache events for monitoring
 */
export interface CacheEvents {
  hit: (key: string, component: CachedComponent) => void;
  miss: (key: string) => void;
  set: (key: string, component: CachedComponent) => void;
  evict: (key: string, reason: 'ttl' | 'size' | 'manual') => void;
  error: (error: Error) => void;
  stats: (stats: CacheStatistics) => void;
}
