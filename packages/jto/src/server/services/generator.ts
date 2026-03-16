import type { FormatAdapter } from '../../format-adapter.js';
import { CacheService } from './cache.js';
import { logger } from '../utils/logger.js';
import { cacheEvents } from '../../services/cache-events.js';

export class GeneratorService {
  private adapter: FormatAdapter;
  private cacheService: CacheService;
  private cacheInvalidationHandler: (() => void) | null = null;

  constructor(adapter: FormatAdapter, cacheService: CacheService) {
    this.adapter = adapter;
    this.cacheService = cacheService;

    this.cacheInvalidationHandler = () => this.cacheService.clear();
    cacheEvents.on('generator:invalidate', this.cacheInvalidationHandler);
  }

  async generate(request: {
    jsonDefinition: any;
    customThemes?: Record<string, any>;
    options?: Record<string, unknown>;
  }): Promise<{
    filename: string;
    fileId?: string;
    buffer: Buffer;
    cached?: boolean;
    warnings?: any[] | null;
  }> {
    const { jsonDefinition, customThemes, options } = request;
    const config =
      typeof jsonDefinition === 'string'
        ? JSON.parse(jsonDefinition)
        : jsonDefinition;

    const bypassCache = options?.bypassCache === true;
    const cacheKeyData = { config, customThemes: customThemes && Object.keys(customThemes).length > 0 ? customThemes : null };
    const cacheKey = this.cacheService.generateCacheKey(cacheKeyData);
    const hasDynamicContent = this.cacheService.hasDynamicContent(config);

    // Try cache
    if (!bypassCache && !hasDynamicContent) {
      const cachedBuffer = this.cacheService.get(cacheKey);
      if (cachedBuffer) {
        logger.info('Served from cache', { title: config.metadata?.title });
        return {
          filename: `${config.metadata?.title || this.adapter.label}${this.adapter.extension}`,
          fileId: Date.now().toString(),
          buffer: cachedBuffer,
          cached: true,
          warnings: null,
        };
      }
    }

    // Generate
    logger.info(`Generating ${this.adapter.label}`, { title: config.metadata?.title });
    const buffer = await this.adapter.generateBuffer(config, { customThemes });

    // Store in cache
    this.cacheService.set(cacheKey, buffer, config, {
      bypassCache: bypassCache || hasDynamicContent,
    });

    return {
      filename: `${config.metadata?.title || this.adapter.label}${this.adapter.extension}`,
      fileId: Date.now().toString(),
      buffer,
      cached: false,
      warnings: null,
    };
  }

  async validate(jsonDefinition: any): Promise<{ valid: boolean; errors?: string[] }> {
    const config =
      typeof jsonDefinition === 'string'
        ? JSON.parse(jsonDefinition)
        : jsonDefinition;

    return this.adapter.validateDocument(config);
  }

  destroy(): void {
    if (this.cacheInvalidationHandler) {
      cacheEvents.off('generator:invalidate', this.cacheInvalidationHandler);
      this.cacheInvalidationHandler = null;
    }
    this.cacheService.clear();
  }
}
