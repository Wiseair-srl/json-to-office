import { EventEmitter } from 'events';

export interface CacheEvents {
  'cache:invalidate': () => void;
  'schema:invalidate': () => void;
  'generator:invalidate': () => void;
}

class CacheEventEmitter extends EventEmitter {
  emit<K extends keyof CacheEvents>(
    event: K,
    ...args: Parameters<CacheEvents[K]>
  ): boolean {
    return super.emit(event, ...args);
  }

  on<K extends keyof CacheEvents>(event: K, listener: CacheEvents[K]): this {
    return super.on(event, listener);
  }

  off<K extends keyof CacheEvents>(event: K, listener: CacheEvents[K]): this {
    return super.off(event, listener);
  }

  once<K extends keyof CacheEvents>(event: K, listener: CacheEvents[K]): this {
    return super.once(event, listener);
  }
}

export const cacheEvents = new CacheEventEmitter();

export function invalidateAllCaches(): void {
  cacheEvents.emit('cache:invalidate');
  cacheEvents.emit('schema:invalidate');
  cacheEvents.emit('generator:invalidate');
}
