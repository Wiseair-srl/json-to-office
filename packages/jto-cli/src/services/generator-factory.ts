import { PluginRegistry } from './plugin-registry.js';
import type {
  FormatAdapter,
  GeneratorOptions,
  GeneratorResult,
} from '@json-to-office/jto-ops';

type ComponentDefinition = any;

export class GeneratorFactory {
  private registry: PluginRegistry;
  private adapter: FormatAdapter;

  constructor(adapter: FormatAdapter) {
    this.registry = PluginRegistry.getInstance();
    this.adapter = adapter;
  }

  // Passes the adapter's result straight through: a narrower type here would
  // silently drop fields (e.g. `themeLabel`) the CLI reports on.
  async createGenerator(
    options: GeneratorOptions = {}
  ): Promise<GeneratorResult> {
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
