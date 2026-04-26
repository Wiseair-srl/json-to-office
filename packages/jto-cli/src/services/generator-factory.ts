import { PluginRegistry } from './plugin-registry.js';
import type { FormatAdapter, GeneratorOptions } from '../format-adapter.js';

type ComponentDefinition = any;

export class GeneratorFactory {
  private registry: PluginRegistry;
  private adapter: FormatAdapter;

  constructor(adapter: FormatAdapter) {
    this.registry = PluginRegistry.getInstance();
    this.adapter = adapter;
  }

  async createGenerator(options: GeneratorOptions = {}): Promise<{
    generateBuffer: (document: ComponentDefinition | string) => Promise<Buffer>;
    hasPlugins: boolean;
    pluginNames: string[];
  }> {
    const plugins = this.registry.getPlugins();
    return this.adapter.createGenerator(plugins, options);
  }

  async generate(
    document: ComponentDefinition | string,
    options: GeneratorOptions = {}
  ): Promise<Buffer> {
    const generator = await this.createGenerator(options);
    return await generator.generateBuffer(document);
  }

  getPluginInfo(): {
    hasPlugins: boolean;
    count: number;
    names: string[];
  } {
    return {
      hasPlugins: this.registry.hasPlugins(),
      count: this.registry.getPluginCount(),
      names: this.registry.getPluginNames(),
    };
  }
}
