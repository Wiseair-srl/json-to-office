import type { CustomComponent } from './plugin-loader.js';
import { PluginLoader } from './plugin-loader.js';
import { PluginDiscoveryService } from './plugin-discovery.js';
import type { PluginMetadata } from './plugin-metadata.js';
import * as path from 'path';
import { invalidateAllCaches } from './cache-events.js';

export class PluginRegistry {
  private static instance: PluginRegistry;
  private plugins: Map<string, CustomComponent> = new Map();
  private pluginPaths: Map<string, string> = new Map();
  private pluginMetadata: Map<string, PluginMetadata> = new Map();
  private loader: PluginLoader;
  private discoveryService: PluginDiscoveryService;
  private _format?: 'docx' | 'pptx';

  private constructor() {
    this.loader = new PluginLoader();
    this.discoveryService = new PluginDiscoveryService();
  }

  static getInstance(): PluginRegistry {
    if (!PluginRegistry.instance) {
      PluginRegistry.instance = new PluginRegistry();
    }
    return PluginRegistry.instance;
  }

  setFormat(format: 'docx' | 'pptx'): void {
    this._format = format;
  }

  private notifyCacheInvalidation(): void {
    try {
      invalidateAllCaches();
    } catch {}
  }

  async loadPlugin(pathOrName: string): Promise<void> {
    try {
      await this.loader.initialize();

      const pluginPath = await this.resolvePluginPath(pathOrName);
      if (!pluginPath) {
        throw new Error(`Plugin '${pathOrName}' not found`);
      }

      const module = await this.loader.loadPlugin(pluginPath);
      if (module) {
        this.plugins.set(module.name, module);
        this.pluginPaths.set(module.name, pluginPath);
        this.notifyCacheInvalidation();
      } else {
        throw new Error(`Failed to load valid component from ${pluginPath}`);
      }
    } catch (error: any) {
      throw new Error(
        `Failed to load plugin '${pathOrName}': ${error.message}`
      );
    }
  }

  async loadPlugins(pathsOrNames: string[]): Promise<void> {
    const errors: string[] = [];

    try {
      for (const pathOrName of pathsOrNames) {
        try {
          await this.loadPlugin(pathOrName);
        } catch (error: any) {
          errors.push(error.message);
        }
      }

      if (errors.length > 0) {
        throw new Error(
          `Failed to load ${errors.length} plugin(s): ${errors.join('; ')}`
        );
      }
    } finally {
      this.loader.cleanup();
    }
  }

  private async loadPluginsFromMetadata(
    pluginMetadata: PluginMetadata[]
  ): Promise<number> {
    let loadedCount = 0;

    for (const metadata of pluginMetadata) {
      try {
        const pluginPath = metadata.filePath;
        const module = await this.loader.loadPlugin(pluginPath);
        if (module) {
          this.plugins.set(module.name, module);
          this.pluginPaths.set(module.name, pluginPath);
          this.pluginMetadata.set(module.name, metadata);
          loadedCount++;
          this.notifyCacheInvalidation();
        }
      } catch {}
    }

    return loadedCount;
  }

  async loadPluginsFromDirectory(dir: string): Promise<number> {
    try {
      await this.loader.initialize();

      const discovery = new PluginDiscoveryService({
        scope: dir,
        maxDepth: 5,
      });

      const pluginMetadata = await discovery.discover(this._format);
      return await this.loadPluginsFromMetadata(pluginMetadata);
    } catch (error: any) {
      throw new Error(
        `Failed to load plugins from directory: ${error.message}`
      );
    } finally {
      this.loader.cleanup();
    }
  }

  async discoverAndLoad(): Promise<{ discovered: number; loaded: number }> {
    try {
      await this.loader.initialize();

      const pluginMetadata = await this.discoveryService.discover(this._format);
      const discovered = pluginMetadata.length;

      if (discovered === 0) {
        return { discovered: 0, loaded: 0 };
      }

      const loaded = await this.loadPluginsFromMetadata(pluginMetadata);
      return { discovered, loaded };
    } catch (error: any) {
      throw new Error(`Failed to discover and load plugins: ${error.message}`);
    } finally {
      this.loader.cleanup();
    }
  }

  async resolvePluginName(name: string): Promise<string | undefined> {
    if (this.pluginPaths.has(name)) {
      return this.pluginPaths.get(name);
    }

    try {
      const pluginMetadata = await this.discoveryService.discover(this._format);
      const metadata = pluginMetadata.find((p) => p.name === name);
      if (metadata) return metadata.filePath;
    } catch {}

    return undefined;
  }

  private async resolvePluginPath(
    pathOrName: string
  ): Promise<string | undefined> {
    if (pathOrName.endsWith('.ts') || pathOrName.endsWith('.js')) {
      return path.resolve(process.cwd(), pathOrName);
    }
    return await this.resolvePluginName(pathOrName);
  }

  getPlugins(): CustomComponent[] {
    return Array.from(this.plugins.values());
  }

  getPluginNames(): string[] {
    return Array.from(this.plugins.keys());
  }

  getPlugin(name: string): CustomComponent | undefined {
    return this.plugins.get(name);
  }

  hasPlugins(): boolean {
    return this.plugins.size > 0;
  }

  getPluginCount(): number {
    return this.plugins.size;
  }

  clear(): void {
    this.plugins.clear();
    this.pluginPaths.clear();
    this.pluginMetadata.clear();
    this.loader.cleanup();
    this.notifyCacheInvalidation();
  }

  static cleanup(): void {
    if (PluginRegistry.instance) {
      PluginRegistry.instance.clear();
    }
  }

  getPluginMetadata(name: string): PluginMetadata | undefined {
    return this.pluginMetadata.get(name);
  }

  getAllPluginMetadata(): PluginMetadata[] {
    return Array.from(this.pluginMetadata.values());
  }
}
