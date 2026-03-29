import * as fs from 'fs/promises';
import * as path from 'path';
import { PluginDiscoveryService } from './plugin-discovery.js';
import type { PluginMetadata } from './plugin-metadata.js';

export class PluginResolver {
  private discoveryService: PluginDiscoveryService;
  private discoveredPlugins: Map<string, PluginMetadata> = new Map();
  private lastDiscoveryTime: number = 0;
  private readonly CACHE_DURATION = 5 * 60 * 1000;
  private format?: 'docx' | 'pptx';

  constructor(format?: 'docx' | 'pptx') {
    this.discoveryService = new PluginDiscoveryService();
    this.format = format;
  }

  async resolve(input: string): Promise<string> {
    const pathResult = await this.resolveAsPath(input);
    if (pathResult) return pathResult;

    const nameResult = await this.resolveAsName(input);
    if (nameResult) return nameResult;

    await this.refreshDiscoveryCache();
    const discoveredResult = await this.resolveAsName(input);
    if (discoveredResult) return discoveredResult;

    throw await this.createNotFoundError(input);
  }

  async resolveMultiple(inputs: string[]): Promise<Map<string, string>> {
    const resolved = new Map<string, string>();
    const errors: string[] = [];

    for (const input of inputs) {
      try {
        const resolvedPath = await this.resolve(input);
        resolved.set(input, resolvedPath);
      } catch (error: any) {
        errors.push(`${input}: ${error.message}`);
      }
    }

    if (errors.length > 0 && errors.length === inputs.length) {
      throw new Error(`Failed to resolve plugins:\n${errors.join('\n')}`);
    }

    return resolved;
  }

  private async resolveAsPath(input: string): Promise<string | null> {
    if (!this.looksLikePath(input)) return null;

    const resolvedPath = path.resolve(process.cwd(), input);

    try {
      const stats = await fs.stat(resolvedPath);
      if (stats.isFile()) return resolvedPath;
    } catch {}

    return null;
  }

  private async resolveAsName(name: string): Promise<string | null> {
    if (this.discoveredPlugins.size === 0 || this.isCacheExpired()) {
      await this.refreshDiscoveryCache();
    }

    const plugin = this.discoveredPlugins.get(name);
    if (plugin) return plugin.filePath;

    const lowerName = name.toLowerCase();
    for (const [pluginName, metadata] of this.discoveredPlugins) {
      if (pluginName.toLowerCase() === lowerName) return metadata.filePath;
    }

    return null;
  }

  private async refreshDiscoveryCache(): Promise<void> {
    try {
      const plugins = await this.discoveryService.discover(this.format);
      this.discoveredPlugins.clear();
      for (const plugin of plugins) {
        this.discoveredPlugins.set(plugin.name, plugin);
      }
      this.lastDiscoveryTime = Date.now();
    } catch (error: any) {
      console.warn(`Plugin discovery failed: ${error.message}`);
    }
  }

  private isCacheExpired(): boolean {
    return Date.now() - this.lastDiscoveryTime > this.CACHE_DURATION;
  }

  private looksLikePath(input: string): boolean {
    if (input.endsWith('.ts') || input.endsWith('.js')) return true;
    if (input.includes('/') || input.includes('\\')) return true;
    if (input.startsWith('./') || input.startsWith('../')) return true;
    if (path.isAbsolute(input)) return true;
    return false;
  }

  private async createNotFoundError(input: string): Promise<Error> {
    let message = `Plugin '${input}' not found.`;

    if (this.discoveredPlugins.size > 0) {
      const suggestions = this.findSimilarNames(input);
      if (suggestions.length > 0) {
        message += '\n\nDid you mean one of these?';
        suggestions.forEach((name) => {
          message += `\n  - ${name}`;
        });
      } else {
        message += '\n\nAvailable plugins:';
        Array.from(this.discoveredPlugins.keys())
          .slice(0, 5)
          .forEach((name) => {
            message += `\n  - ${name}`;
          });
        if (this.discoveredPlugins.size > 5) {
          message += `\n  ... and ${this.discoveredPlugins.size - 5} more`;
        }
      }
    }

    message += "\n\nUse 'jto <format> discover' to list all available plugins.";

    return new Error(message);
  }

  private findSimilarNames(input: string): string[] {
    const inputLower = input.toLowerCase();
    const suggestions: string[] = [];

    for (const name of this.discoveredPlugins.keys()) {
      const nameLower = name.toLowerCase();
      if (nameLower.includes(inputLower) || inputLower.includes(nameLower)) {
        suggestions.push(name);
      } else if (nameLower.startsWith(inputLower[0])) {
        suggestions.push(name);
      }
      if (suggestions.length >= 3) break;
    }

    return suggestions;
  }

  async getAvailablePluginNames(): Promise<string[]> {
    if (this.discoveredPlugins.size === 0 || this.isCacheExpired()) {
      await this.refreshDiscoveryCache();
    }
    return Array.from(this.discoveredPlugins.keys());
  }

  clearCache(): void {
    this.discoveredPlugins.clear();
    this.lastDiscoveryTime = 0;
  }
}
