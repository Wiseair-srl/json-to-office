/**
 * Cache Manager Base Class
 * Abstract base class for cache implementations
 */

import { EventEmitter } from 'events';
import {
  CachedComponent,
  CacheConfiguration,
  CacheStatistics,
  ComponentStatistics,
} from './types';

/**
 * Main cache manager abstract class
 */
export abstract class ComponentCacheManager extends EventEmitter {
  protected config: CacheConfiguration;
  protected stats: CacheStatistics;

  constructor(config: CacheConfiguration) {
    super();
    this.config = config;
    this.stats = this.initializeStats();
  }

  /**
   * Get a cached component
   */
  abstract get(key: string): Promise<CachedComponent | undefined>;

  /**
   * Set a cached component
   */
  abstract set(key: string, component: CachedComponent): Promise<void>;

  /**
   * Check if key exists
   */
  abstract has(key: string): Promise<boolean>;

  /**
   * Delete a cached entry
   */
  abstract delete(key: string): Promise<boolean>;

  /**
   * Clear all cache entries
   */
  abstract clear(): Promise<void>;

  /**
   * Get all keys (for utilities)
   */
  abstract getKeys(): Promise<string[]>;

  /**
   * Get cache statistics with deep immutability
   */
  getStats(): CacheStatistics {
    // Create a deep copy of the componentStats Map
    const componentStatsCopy = new Map<string, ComponentStatistics>();
    this.stats.componentStats.forEach((value, key) => {
      // Deep copy each ComponentStatistics object
      componentStatsCopy.set(key, { ...value });
    });

    // Return a deep copy of the stats object
    return {
      ...this.stats,
      componentStats: componentStatsCopy,
    };
  }

  /**
   * Get configuration with deep immutability
   */
  getConfig(): CacheConfiguration {
    // Deep copy the configuration object
    const configCopy: CacheConfiguration = {
      enabled: this.config.enabled,
      evictionPolicy: this.config.evictionPolicy,
      memory: { ...this.config.memory },
      performance: { ...this.config.performance },
    };

    // Deep copy optional disk configuration if present
    if (this.config.disk) {
      configCopy.disk = { ...this.config.disk };
    }

    // Deep copy componentConfig if present
    if (this.config.componentConfig) {
      configCopy.componentConfig = {};
      for (const [key, value] of Object.entries(this.config.componentConfig)) {
        configCopy.componentConfig[key] = { ...value };
      }
    }

    return configCopy;
  }

  /**
   * Get multiple entries (batch operation)
   */
  async getMany(keys: string[]): Promise<Map<string, CachedComponent>> {
    const results = new Map<string, CachedComponent>();

    if (this.config.performance.parallelProcessing) {
      const promises = keys.map(async (key) => {
        const value = await this.get(key);
        if (value) results.set(key, value);
      });
      await Promise.all(promises);
    } else {
      for (const key of keys) {
        const value = await this.get(key);
        if (value) results.set(key, value);
      }
    }

    return results;
  }

  /**
   * Set multiple entries (batch operation)
   */
  async setMany(entries: [string, CachedComponent][]): Promise<void> {
    if (this.config.performance.parallelProcessing) {
      const promises = entries.map(([key, value]) => this.set(key, value));
      await Promise.all(promises);
    } else {
      for (const [key, value] of entries) {
        await this.set(key, value);
      }
    }
  }

  /**
   * Delete multiple entries
   */
  async deleteMany(keys: string[]): Promise<number> {
    let deleted = 0;

    if (this.config.performance.parallelProcessing) {
      const results = await Promise.all(keys.map((key) => this.delete(key)));
      deleted = results.filter(Boolean).length;
    } else {
      for (const key of keys) {
        if (await this.delete(key)) {
          deleted++;
        }
      }
    }

    return deleted;
  }

  /**
   * Initialize statistics
   */
  protected initializeStats(): CacheStatistics {
    return {
      entries: 0,
      totalSize: 0,
      hitRate: 0,
      missRate: 0,
      totalHits: 0,
      totalMisses: 0,
      avgResponseTime: 0,
      evictions: 0,
      componentStats: new Map(),
    };
  }

  /**
   * Update statistics on cache hit
   */
  protected updateHitStats(key: string, component: CachedComponent): void {
    this.stats.totalHits++;
    this.updateComponentStats(component.componentName, 'hit');
    this.recalculateRates();
    this.emit('hit', key, component);
  }

  /**
   * Update statistics on cache miss
   */
  protected updateMissStats(key: string, componentName?: string): void {
    this.stats.totalMisses++;
    if (componentName) {
      this.updateComponentStats(componentName, 'miss');
    }
    this.recalculateRates();
    this.emit('miss', key);
  }

  /**
   * Update component-specific statistics
   */
  protected updateComponentStats(componentName: string, event: 'hit' | 'miss'): void {
    if (!this.stats.componentStats.has(componentName)) {
      this.stats.componentStats.set(componentName, {
        name: componentName,
        hits: 0,
        misses: 0,
        avgProcessTime: 0,
        avgSize: 0,
        entries: 0,
      });
    }

    const stats = this.stats.componentStats.get(componentName)!;
    if (event === 'hit') {
      stats.hits++;
    } else {
      stats.misses++;
    }
  }

  /**
   * Recalculate hit/miss rates
   */
  protected recalculateRates(): void {
    const total = this.stats.totalHits + this.stats.totalMisses;
    if (total > 0) {
      this.stats.hitRate = this.stats.totalHits / total;
      this.stats.missRate = this.stats.totalMisses / total;
    }
  }

  /**
   * Emit statistics periodically
   */
  protected emitStats(): void {
    this.emit('stats', this.getStats());
  }
}
