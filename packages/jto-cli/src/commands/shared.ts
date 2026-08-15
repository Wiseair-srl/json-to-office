import { PluginRegistry } from '../services/plugin-registry.js';
import { PluginResolver } from '../services/plugin-resolver.js';
import { PluginConfigService } from '../config/plugin-config.js';
import type { TaskReporter } from './ui.js';

interface PluginOptions {
  plugins?: string | boolean;
  pluginDir?: string;
}

export async function loadPlugins(
  options: PluginOptions,
  config: any,
  configService: PluginConfigService,
  reporter: TaskReporter,
  format?: 'docx' | 'pptx'
): Promise<void> {
  const registry = PluginRegistry.getInstance();
  if (format) registry.setFormat(format);

  if (options.plugins !== undefined) {
    reporter.update('Loading plugins...');

    if (options.plugins === true) {
      const result = await registry.discoverAndLoad();
      if (result.discovered > 0) {
        reporter.update(
          `Loaded ${result.loaded}/${result.discovered} discovered plugins...`
        );
      }
    } else if (
      typeof options.plugins === 'string' &&
      options.plugins.length > 0
    ) {
      const pluginList = options.plugins.split(',').map((p) => p.trim());
      for (const plugin of pluginList) {
        await registry.loadPlugin(plugin);
      }
    }
  } else if (config?.autoDiscover) {
    reporter.update('Auto-discovering plugins...');
    const result = await registry.discoverAndLoad();
    if (result.discovered > 0) {
      reporter.update(
        `Loaded ${result.loaded}/${result.discovered} discovered plugins...`
      );
    }
  } else if (config?.plugins && config.plugins.length > 0) {
    reporter.update('Loading configured plugins...');
    const resolver = new PluginResolver(format);
    const resolved = await resolver.resolveMultiple(config.plugins);
    const paths: string[] = [];
    for (const [, resolvedPath] of resolved) {
      paths.push(resolvedPath);
    }
    await registry.loadPlugins(paths);
  }

  if (options.pluginDir) {
    reporter.update(`Loading plugins from ${options.pluginDir}...`);
    const loadedCount = await registry.loadPluginsFromDirectory(
      options.pluginDir
    );
    if (loadedCount > 0) {
      reporter.update(
        `Loaded ${loadedCount} plugin(s) from ${options.pluginDir}...`
      );
    }
  } else if (config?.pluginDirs) {
    for (const dir of configService.getPluginDirectories()) {
      const loadedCount = await registry.loadPluginsFromDirectory(dir);
      if (loadedCount > 0) {
        reporter.update(`Loaded ${loadedCount} plugin(s) from ${dir}...`);
      }
    }
  }
}
