/**
 * Cache Key Generator
 * Generates deterministic cache keys for components
 */

import { createHash } from 'crypto';
import { ComponentDefinition, RenderContext } from '../types';
import { CacheKeyOptions } from '@json-to-office/shared/cache';

/**
 * Cache key generator with deterministic hashing
 */
export class CacheKeyGenerator {
  private readonly version: string;

  constructor(version: string = '1.0') {
    this.version = version;
  }

  /**
   * Generate cache key for a component
   */
  generateKey(
    component: ComponentDefinition,
    context: RenderContext,
    options: CacheKeyOptions = {}
  ): string {
    const parts: string[] = [
      this.version,
      component.name,
      this.hashProps(component.props),
    ];

    if (options.includeTheme !== false) {
      parts.push(context.theme.name);
    }

    if (options.includeContext) {
      parts.push(this.hashContext(context));
    }

    if (options.additionalKeys) {
      parts.push(...options.additionalKeys);
    }

    if (options.version) {
      parts.push(options.version);
    }

    return parts.join(':');
  }

  /**
   * Hash component props
   */
  hashProps(props: any): string {
    if (!props) return 'null';

    // Sort keys for consistent hashing
    const normalized = this.normalizeObject(props);
    const json = JSON.stringify(normalized);

    return this.hash(json);
  }

  /**
   * Hash render context
   */
  private hashContext(context: RenderContext): string {
    // Only hash relevant context properties
    const relevant = {
      theme: context.theme.name,
      document: context.document,
      // Exclude runtime properties like sectionIndex, componentIndex
    };

    return this.hash(JSON.stringify(relevant));
  }

  /**
   * Normalize object for consistent hashing
   */
  private normalizeObject(obj: any): any {
    if (obj === null || obj === undefined) return obj;

    if (Array.isArray(obj)) {
      return obj.map((item) => this.normalizeObject(item));
    }

    if (obj instanceof Date) {
      return obj.toISOString();
    }

    if (typeof obj === 'object') {
      const sorted: any = {};
      const keys = Object.keys(obj).sort();

      for (const key of keys) {
        sorted[key] = this.normalizeObject(obj[key]);
      }

      return sorted;
    }

    return obj;
  }

  /**
   * Create hash
   */
  private hash(input: string): string {
    return createHash('sha256').update(input).digest('hex').substring(0, 16); // Use first 16 chars for shorter keys
  }
}
