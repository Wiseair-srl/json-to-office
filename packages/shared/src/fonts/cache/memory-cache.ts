/**
 * In-process LRU cache for resolved font buffers.
 * Scoped to a single process — do not share across requests on a server.
 */

export interface MemoryCacheOptions {
  /** Approximate soft cap in bytes. LRU-evict when exceeded. */
  maxBytes?: number;
}

export class FontMemoryCache {
  private readonly store = new Map<string, Buffer>();
  private bytes = 0;
  private readonly maxBytes: number;

  constructor(opts: MemoryCacheOptions = {}) {
    this.maxBytes = opts.maxBytes ?? 20 * 1024 * 1024; // 20 MB default
  }

  get(key: string): Buffer | undefined {
    const v = this.store.get(key);
    if (!v) return undefined;
    // Refresh LRU position.
    this.store.delete(key);
    this.store.set(key, v);
    return v;
  }

  set(key: string, value: Buffer): void {
    const existing = this.store.get(key);
    if (existing) this.bytes -= existing.byteLength;
    this.store.set(key, value);
    this.bytes += value.byteLength;
    while (this.bytes > this.maxBytes && this.store.size > 0) {
      const oldest = this.store.keys().next().value as string | undefined;
      if (!oldest) break;
      const removed = this.store.get(oldest);
      this.store.delete(oldest);
      if (removed) this.bytes -= removed.byteLength;
    }
  }

  size(): number {
    return this.store.size;
  }
}
