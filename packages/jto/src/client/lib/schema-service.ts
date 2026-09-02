/**
 * Client-side service for fetching and caching JSON schemas
 */

import { API_BASE_URL } from '../config/api';
import type { BrowserComponentSchemaInfo } from '../store/browser-plugins-store';

interface SchemaResponse {
  success: boolean;
  data?: any;
  error?: string;
}

class SchemaService {
  private documentSchemaCache: any | null = null;
  private themeSchemaCache: any | null = null;
  private pluginSchemaCache: Map<string, any> = new Map();
  private cacheTimestamp: { [key: string]: number } = {};
  private readonly CACHE_DURATION = 5 * 60 * 1000; // 5 minutes
  private readonly MAX_PLUGIN_CACHE = 10;

  /**
   * Fetch the JSON schema for document validation
   * @param pluginNames Optional array of plugin names to include in the schema
   * @param browserComponents Components compiled in the browser, by metadata;
   *   when present the request is a POST carrying their props schemas.
   */
  async fetchDocumentSchema(
    pluginNames?: string[],
    browserComponents?: BrowserComponentSchemaInfo[]
  ): Promise<any> {
    // Create cache key based on plugins. An explicit selection (even [])
    // is cached apart from the "unspecified" default, which the server
    // resolves to every registered plugin. Browser components are part of
    // the key too: their schemas change on every edit of the plugin file.
    const browserKey =
      browserComponents && browserComponents.length > 0
        ? `+browser:${JSON.stringify(browserComponents)}`
        : '';
    const cacheKey = pluginNames
      ? `document-${[...pluginNames].sort().join(',')}${browserKey}`
      : `document${browserKey}`;

    // Check cache first
    if (pluginNames || browserKey) {
      const cached = this.pluginSchemaCache.get(cacheKey);
      if (cached && this.isCacheValid(cacheKey)) {
        return cached;
      }
    } else if (this.documentSchemaCache && this.isCacheValid('document')) {
      return this.documentSchemaCache;
    }

    try {
      let response: Response;
      if (browserKey) {
        // Browser plugins ride in the body; the server composes their schemas
        // next to the disk plugins and never sees their code.
        response = await fetch(`${API_BASE_URL}/discovery/schemas/document`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...(pluginNames ? { plugins: pluginNames } : {}),
            customComponents: browserComponents,
          }),
        });
      } else {
        // Build URL with plugin query params. An explicit selection is always
        // sent — `plugins=` (empty) tells the server "no plugins", instead of
        // silently falling back to the all-plugins default.
        let url = `${API_BASE_URL}/discovery/schemas/document`;
        if (pluginNames) {
          // eslint-disable-next-line no-undef
          const params = new URLSearchParams();
          params.append('plugins', pluginNames.join(','));
          url = `${url}?${params.toString()}`;
        }
        response = await fetch(url);
      }

      if (!response.ok) {
        throw new Error(
          `Failed to fetch document schema: ${response.statusText}`
        );
      }

      const result: SchemaResponse = await response.json();

      if (!result.success || !result.data) {
        throw new Error(result.error || 'Failed to fetch document schema');
      }

      // Cache the schema
      if (pluginNames || browserKey) {
        if (this.pluginSchemaCache.size >= this.MAX_PLUGIN_CACHE) {
          const firstKey = this.pluginSchemaCache.keys().next().value;
          if (firstKey) this.pluginSchemaCache.delete(firstKey);
        }
        this.pluginSchemaCache.set(cacheKey, result.data);
      } else {
        this.documentSchemaCache = result.data;
      }
      this.cacheTimestamp[cacheKey] = Date.now();

      return result.data;
    } catch (error) {
      console.error('Error fetching document schema:', error);
      throw error;
    }
  }

  /**
   * Fetch the JSON schema for theme validation
   */
  async fetchThemeSchema(): Promise<any> {
    // Check cache first
    if (this.themeSchemaCache && this.isCacheValid('theme')) {
      return this.themeSchemaCache;
    }

    try {
      const response = await fetch(`${API_BASE_URL}/discovery/schemas/theme`);

      if (!response.ok) {
        throw new Error(`Failed to fetch theme schema: ${response.statusText}`);
      }

      const result: SchemaResponse = await response.json();

      if (!result.success || !result.data) {
        throw new Error(result.error || 'Failed to fetch theme schema');
      }

      // Cache the schema
      this.themeSchemaCache = result.data;
      this.cacheTimestamp.theme = Date.now();

      return result.data;
    } catch (error) {
      console.error('Error fetching theme schema:', error);
      throw error;
    }
  }

  /**
   * Get the appropriate schema based on the active tab type
   */
  async getSchemaForActiveTab(tabType: 'document' | 'theme'): Promise<any> {
    if (tabType === 'theme') {
      return this.fetchThemeSchema();
    }
    return this.fetchDocumentSchema();
  }

  /**
   * Clear all cached schemas
   */
  clearCache(): void {
    this.documentSchemaCache = null;
    this.themeSchemaCache = null;
    this.pluginSchemaCache.clear();
    this.cacheTimestamp = {};
  }

  /**
   * Clear plugin-specific schema cache
   */
  clearPluginSchemaCache(): void {
    this.pluginSchemaCache.clear();
    // Clear cache timestamps for plugin schemas
    Object.keys(this.cacheTimestamp).forEach((key) => {
      if (key.startsWith('document-')) {
        delete this.cacheTimestamp[key];
      }
    });
  }

  /**
   * Check if cache is still valid
   */
  private isCacheValid(type: string): boolean {
    const timestamp = this.cacheTimestamp[type];
    if (!timestamp) return false;

    return Date.now() - timestamp < this.CACHE_DURATION;
  }

  /**
   * Format schema for display (pretty print)
   */
  formatSchemaForDisplay(schema: any): string {
    return JSON.stringify(schema, null, 2);
  }

  /**
   * Get schema metadata
   */
  getSchemaMetadata(schema: any): {
    title?: string;
    description?: string;
    version?: string;
    $schema?: string;
  } {
    return {
      title: schema.title,
      description: schema.description,
      version: schema.version || schema.$id,
      $schema: schema.$schema,
    };
  }
}

// Export singleton instance
export const schemaService = new SchemaService();

// Export types
export type SchemaType = 'document' | 'theme';
