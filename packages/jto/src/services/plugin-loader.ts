import * as path from 'path';
import { pathToFileURL } from 'url';

export interface CustomComponent {
  name: string;
  versions?: Record<string, any>;
  [key: string]: any;
}

let globalTsxUnregister: (() => void) | undefined;
let tsxInitializationPromise: Promise<void> | undefined;

export class PluginLoader {
  private tsxUnregister?: () => void;

  async initialize(): Promise<void> {
    if (globalTsxUnregister) {
      this.tsxUnregister = globalTsxUnregister;
      return;
    }

    if (tsxInitializationPromise) {
      await tsxInitializationPromise;
      this.tsxUnregister = globalTsxUnregister;
      return;
    }

    tsxInitializationPromise = (async () => {
      try {
        const { register } = await import('tsx/esm/api');
        globalTsxUnregister = register();
        this.tsxUnregister = globalTsxUnregister;
      } catch {
        console.warn('tsx not available, TypeScript module loading may fail');
      }
    })();

    await tsxInitializationPromise;
  }

  async loadPlugin(filePath: string): Promise<CustomComponent | null> {
    try {
      if (!filePath.endsWith('.ts')) {
        return null;
      }

      if (!this.tsxUnregister) {
        await this.initialize();
      }

      const fileUrl = pathToFileURL(filePath).href;
      const module = await import(`${fileUrl}?t=${Date.now()}`);
      return this.extractComponent(module, filePath);
    } catch (error: any) {
      if (process.env.DEBUG) {
        console.error(`Failed to load plugin from ${filePath}:`, error);
      } else {
        console.warn(
          `Failed to load plugin from ${path.basename(filePath)}: ${error.message}`
        );
      }
      return null;
    }
  }

  async loadPlugins(
    filePaths: string[]
  ): Promise<Map<string, CustomComponent>> {
    const plugins = new Map<string, CustomComponent>();

    const results = await Promise.allSettled(
      filePaths.map(async (filePath) => {
        const module = await this.loadPlugin(filePath);
        return { filePath, module };
      })
    );

    for (const result of results) {
      if (result.status === 'fulfilled' && result.value.module) {
        plugins.set(result.value.filePath, result.value.module);
      }
    }

    return plugins;
  }

  private extractComponent(
    module: any,
    filePath: string
  ): CustomComponent | null {
    if (module.default && this.isValidComponent(module.default)) {
      return module.default;
    }

    const componentExports = Object.entries(module)
      .filter(
        ([key]) =>
          key.endsWith('Component') ||
          key.endsWith('component') ||
          key.endsWith('Module') ||
          key.endsWith('module')
      )
      .map(([_, value]) => value);

    for (const exportedValue of componentExports) {
      if (this.isValidComponent(exportedValue)) {
        return exportedValue as CustomComponent;
      }
    }

    for (const [key, value] of Object.entries(module)) {
      if (this.isValidComponent(value)) {
        if (process.env.DEBUG) {
          console.log(
            `Found component in export '${key}' from ${path.basename(filePath)}`
          );
        }
        return value as CustomComponent;
      }
    }

    return null;
  }

  private isValidComponent(obj: any): boolean {
    if (!obj || typeof obj !== 'object') {
      return false;
    }

    const hasName = typeof obj.name === 'string' && obj.name.length > 0;

    if (obj.versions && typeof obj.versions === 'object') {
      const entries = Object.values(obj.versions);
      return (
        hasName &&
        entries.length > 0 &&
        entries.some(
          (entry: any) =>
            entry &&
            typeof entry === 'object' &&
            entry.propsSchema &&
            typeof entry.propsSchema === 'object' &&
            typeof entry.render === 'function'
        )
      );
    }

    return false;
  }

  cleanup(): void {
    this.tsxUnregister = undefined;
  }
}
