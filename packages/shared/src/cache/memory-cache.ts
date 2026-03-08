/**
 * Memory Cache Implementation
 * In-memory cache with LRU eviction policy
 */

import { ComponentCacheManager } from './manager';
import { CachedComponent, CacheConfiguration } from './types';

/**
 * LRU node for doubly-linked list
 */
class LRUNode<T> {
  key: string;
  value: T;
  prev: LRUNode<T> | null = null;
  next: LRUNode<T> | null = null;

  constructor(key: string, value: T) {
    this.key = key;
    this.value = value;
  }
}

/**
 * In-memory cache with LRU eviction
 */
export class MemoryCache extends ComponentCacheManager {
  private cache: Map<string, LRUNode<CachedComponent>>;
  private head: LRUNode<CachedComponent> | null = null;
  private tail: LRUNode<CachedComponent> | null = null;
  private currentSize: number = 0;
  private keyToComponentName: Map<string, string> = new Map();
  private cleanupTimer?: NodeJS.Timeout;

  constructor(config: CacheConfiguration) {
    super(config);
    this.cache = new Map();
    if (config.memory.cleanupInterval > 0) {
      this.startCleanupTimer();
    }
  }

  async get(key: string): Promise<CachedComponent | undefined> {
    const node = this.cache.get(key);

    if (!node) {
      // Try to get component name from our mapping first, then from the key itself
      const componentName =
        this.keyToComponentName.get(key) || this.extractComponentNameFromKey(key);
      this.updateMissStats(key, componentName);
      return undefined;
    }

    const component = node.value;

    // Check if expired
    if (this.isExpired(component)) {
      await this.delete(key);
      this.updateMissStats(key, component.componentName);
      return undefined;
    }

    // Update access time and move to head (MRU)
    component.lastAccessed = Date.now();
    component.hits++;
    this.moveToHead(node);

    this.updateHitStats(key, component);
    return component;
  }

  async set(key: string, component: CachedComponent): Promise<void> {
    // Check if component is cacheable
    if (!this.isCacheable(component.componentName)) {
      return;
    }

    // Store the component name mapping
    this.keyToComponentName.set(key, component.componentName);

    // Remove existing entry if present
    if (this.cache.has(key)) {
      await this.delete(key);
    }

    // Check size constraints
    await this.ensureSpace(component.size);

    // Create new node and add to head
    const node = new LRUNode(key, component);
    this.cache.set(key, node);
    this.addToHead(node);

    // Update stats
    this.currentSize += component.size;
    this.stats.entries++;
    this.stats.totalSize = this.currentSize;

    // Update component stats
    let componentStats = this.stats.componentStats.get(component.componentName);
    if (!componentStats) {
      componentStats = {
        name: component.componentName,
        hits: 0,
        misses: 0,
        entries: 0,
        avgSize: 0,
        avgProcessTime: 0,
      };
      this.stats.componentStats.set(component.componentName, componentStats);
    }
    componentStats.entries++;
    componentStats.avgSize =
      (componentStats.avgSize * (componentStats.entries - 1) + component.size) /
      componentStats.entries;

    this.emit('set', key, component);
  }

  async has(key: string): Promise<boolean> {
    const node = this.cache.get(key);
    if (!node) return false;
    return !this.isExpired(node.value);
  }

  async delete(key: string): Promise<boolean> {
    const node = this.cache.get(key);
    if (!node) return false;

    this.removeNode(node);
    this.cache.delete(key);
    this.keyToComponentName.delete(key);

    // Update stats
    this.currentSize -= node.value.size;
    this.stats.entries--;
    this.stats.totalSize = this.currentSize;

    // Update component stats
    const componentStats = this.stats.componentStats.get(node.value.componentName);
    if (componentStats && componentStats.entries > 0) {
      componentStats.entries--;
    }

    return true;
  }

  async clear(): Promise<void> {
    this.cache.clear();
    this.keyToComponentName.clear();
    this.head = null;
    this.tail = null;
    this.currentSize = 0;
    this.stats = this.initializeStats();
  }

  async getKeys(): Promise<string[]> {
    return Array.from(this.cache.keys());
  }

  /**
   * Extract component name from cache key
   */
  private extractComponentNameFromKey(key: string): string | undefined {
    // Cache key format: version:componentName:propsHash:...
    const parts = key.split(':');
    return parts.length >= 2 ? parts[1] : undefined;
  }

  /**
   * Check if component is expired
   */
  private isExpired(component: CachedComponent): boolean {
    if (!component.ttl) return false;
    return Date.now() - component.timestamp > component.ttl * 1000;
  }

  /**
   * Check if component is cacheable
   */
  private isCacheable(componentName: string): boolean {
    const componentConfig = this.config.componentConfig?.[componentName];
    return componentConfig?.cacheable !== false;
  }

  /**
   * Ensure enough space for new entry
   */
  private async ensureSpace(requiredSize: number): Promise<void> {
    const maxSize = this.config.memory.maxSize * 1024 * 1024; // Convert MB to bytes

    // Evict based on size
    while (this.currentSize + requiredSize > maxSize && this.tail) {
      const keyToEvict = this.tail.key;
      await this.delete(keyToEvict);
      this.stats.evictions++;
      this.emit('evict', keyToEvict, 'size');
    }

    // Also check max entries
    const maxEntries = this.config.memory.maxEntries;
    while (this.stats.entries >= maxEntries && this.tail) {
      const keyToEvict = this.tail.key;
      await this.delete(keyToEvict);
      this.stats.evictions++;
      this.emit('evict', keyToEvict, 'size');
    }
  }

  /**
   * LRU operations - Add node to head
   */
  private addToHead(node: LRUNode<CachedComponent>): void {
    node.prev = null;
    node.next = this.head;

    if (this.head) {
      this.head.prev = node;
    }

    this.head = node;

    if (!this.tail) {
      this.tail = node;
    }
  }

  /**
   * Remove node from list
   */
  private removeNode(node: LRUNode<CachedComponent>): void {
    if (node.prev) {
      node.prev.next = node.next;
    } else {
      this.head = node.next;
    }

    if (node.next) {
      node.next.prev = node.prev;
    } else {
      this.tail = node.prev;
    }
  }

  /**
   * Move node to head
   */
  private moveToHead(node: LRUNode<CachedComponent>): void {
    if (node === this.head) return;
    this.removeNode(node);
    this.addToHead(node);
  }

  /**
   * Start cleanup timer for expired entries
   */
  private startCleanupTimer(): void {
    this.cleanupTimer = setInterval(
      async () => {
        const keysToDelete: string[] = [];

        for (const [key, node] of this.cache) {
          if (this.isExpired(node.value)) {
            keysToDelete.push(key);
          }
        }

        for (const key of keysToDelete) {
          await this.delete(key);
          this.stats.evictions++;
          this.emit('evict', key, 'ttl');
        }
      },
      (this.config.memory?.cleanupInterval || 300) * 1000
    );
  }

  /**
   * Stop cleanup timer
   */
  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }
  }
}
