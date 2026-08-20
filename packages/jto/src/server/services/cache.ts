import { LRUCache } from 'lru-cache';
import crypto from 'crypto';
import { logger } from '../utils/logger.js';
import { config } from '../config/index.js';
import { cacheEvents } from '@json-to-office/jto-cli';
import type { GenerationWarning } from '@json-to-office/shared';

/**
 * A cached generation: the bytes plus the warnings that produced them.
 * Storing bare Buffers meant a cache HIT reported no warnings at all, so the
 * second render of a document with an unresolvable font went silent.
 */
export interface CachedGeneration {
  buffer: Buffer;
  warnings: GenerationWarning[] | null;
}

export interface CacheStats {
  hits: number;
  misses: number;
  evictions: number;
  size: number;
  itemCount: number;
}

export class CacheService {
  private cache: LRUCache<string, CachedGeneration>;
  private stats: CacheStats = {
    hits: 0,
    misses: 0,
    evictions: 0,
    size: 0,
    itemCount: 0,
  };
  private cacheInvalidationHandler: (() => void) | null = null;

  constructor() {
    const maxSizeBytes = config.cache.maxSizeMB * 1024 * 1024;

    this.cache = new LRUCache<string, CachedGeneration>({
      max: config.cache.maxItems,
      maxSize: maxSizeBytes,
      // Must stay the buffer's byte length: lru-cache rejects a zero or
      // undefined size when `maxSize` is set.
      sizeCalculation: (value: CachedGeneration) => value.buffer.length,
      ttl: config.cache.ttlSeconds * 1000,
      dispose: (
        _value: CachedGeneration,
        _key: string,
        reason: LRUCache.DisposeReason
      ) => {
        if (reason === 'evict' || reason === 'delete') {
          this.stats.evictions++;
        }
      },
      updateAgeOnGet: true,
      updateAgeOnHas: false,
    });

    this.cacheInvalidationHandler = () => this.clear();
    cacheEvents.on('cache:invalidate', this.cacheInvalidationHandler);
  }

  generateCacheKey(data: unknown): string {
    const normalized = JSON.stringify(data, this.sortKeysReplacer);
    return crypto.createHash('sha256').update(normalized).digest('hex');
  }

  private sortKeysReplacer(_key: string, value: unknown): unknown {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return Object.keys(value)
        .sort()
        .reduce((sorted: Record<string, unknown>, key) => {
          sorted[key] = (value as Record<string, unknown>)[key];
          return sorted;
        }, {});
    }
    return value;
  }

  hasDynamicContent(data: unknown): boolean {
    const str = JSON.stringify(data);
    const patterns = [
      /\{\{now\}\}/i,
      /\{\{date\}\}/i,
      /\{\{time\}\}/i,
      /\{\{timestamp\}\}/i,
      /\{\{random\}\}/i,
      /\{\{uuid\}\}/i,
    ];
    return patterns.some((p) => p.test(str));
  }

  get(key: string): CachedGeneration | null {
    if (!config.features.cache) return null;
    const value = this.cache.get(key);
    if (value) {
      this.stats.hits++;
      this.updateStats();
      return value;
    }
    this.stats.misses++;
    return null;
  }

  set(
    key: string,
    value: CachedGeneration,
    documentConfig: unknown,
    options?: { bypassCache?: boolean }
  ): void {
    if (
      !config.features.cache ||
      options?.bypassCache ||
      this.hasDynamicContent(documentConfig)
    )
      return;
    this.cache.set(key, value);
    this.updateStats();
  }

  clear(): void {
    this.cache.clear();
    this.stats = { hits: 0, misses: 0, evictions: 0, size: 0, itemCount: 0 };
    logger.info('Cache cleared');
  }

  getStats(): CacheStats & { enabled: boolean; hitRate: number } {
    const total = this.stats.hits + this.stats.misses;
    return {
      ...this.stats,
      enabled: config.features.cache,
      hitRate:
        total > 0 ? Math.round((this.stats.hits / total) * 100) / 100 : 0,
    };
  }

  private updateStats(): void {
    this.stats.size = this.cache.calculatedSize || 0;
    this.stats.itemCount = this.cache.size;
  }

  destroy(): void {
    if (this.cacheInvalidationHandler) {
      cacheEvents.off('cache:invalidate', this.cacheInvalidationHandler);
      this.cacheInvalidationHandler = null;
    }
  }
}
