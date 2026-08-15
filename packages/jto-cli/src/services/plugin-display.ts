import type { PluginMetadata } from './plugin-metadata.js';
import { renderLines, writeJson, type UiLine } from '../commands/ui.js';

export interface DisplayOptions {
  json?: boolean;
  schema?: boolean;
  examples?: boolean;
  verbose?: boolean;
}

export class PluginDisplay {
  constructor(private readonly options: DisplayOptions = {}) {}

  async show(plugins: PluginMetadata[]): Promise<void> {
    if (this.options.json) {
      writeJson({
        plugins: plugins.map((plugin) => this.formatPluginForJson(plugin)),
        count: plugins.length,
        locations: {
          upstream: plugins.filter((plugin) => plugin.location === 'upstream')
            .length,
          current: plugins.filter((plugin) => plugin.location === 'current')
            .length,
          downstream: plugins.filter(
            (plugin) => plugin.location === 'downstream'
          ).length,
        },
      });
      return;
    }
    await renderLines(this.consoleLines(plugins));
  }

  private formatPluginForJson(plugin: PluginMetadata): Record<string, unknown> {
    const formatted: Record<string, unknown> = {
      name: plugin.name,
      description: plugin.description,
      version: plugin.version,
      filePath: plugin.filePath,
      relativePath: plugin.relativePath,
      location: plugin.location,
    };
    if (this.options.schema) {
      formatted.schema = plugin.schema.jsonSchema || plugin.schema.raw;
      formatted.properties = plugin.schema.properties;
    }
    if (this.options.examples && plugin.examples)
      formatted.examples = plugin.examples;
    return formatted;
  }

  private consoleLines(plugins: PluginMetadata[]): UiLine[] {
    const lines: UiLine[] = [
      { text: 'Custom Plugins Discovery', tone: 'info' },
    ];
    const locations = ['upstream', 'current', 'downstream'] as const;
    lines.push({ text: 'Search results:' });
    for (const location of locations) {
      const count = plugins.filter(
        (plugin) => plugin.location === location
      ).length;
      if (count > 0) {
        lines.push({
          text: `  ${location}: ${count} plugin${count === 1 ? '' : 's'} found`,
          tone: 'success',
        });
      }
    }
    if (plugins.length === 0) {
      return [
        ...lines,
        { text: 'No plugins found.', tone: 'warning' },
        {
          text: 'Custom components must follow the *.component.ts naming convention.',
          tone: 'muted',
        },
      ];
    }
    for (const plugin of plugins) lines.push(...this.pluginLines(plugin));
    lines.push({
      text: `Total: ${plugins.length} plugin${plugins.length === 1 ? '' : 's'} discovered`,
    });
    return lines;
  }

  private pluginLines(plugin: PluginMetadata): UiLine[] {
    const icon = { upstream: '^', current: '*', downstream: 'v' }[
      plugin.location
    ];
    const lines: UiLine[] = [
      { text: `${plugin.name}`, tone: 'warning' },
      { text: `  ${icon} Path: ${plugin.relativePath}`, tone: 'muted' },
    ];
    if (plugin.description)
      lines.push({ text: `  Description: ${plugin.description}` });
    if (plugin.version) lines.push({ text: `  Version: ${plugin.version}` });
    if (this.options.schema && plugin.schema.properties) {
      lines.push({ text: '  Schema properties:', tone: 'muted' });
      for (const [key, property] of Object.entries(plugin.schema.properties)) {
        const value = property as any;
        lines.push({
          text: `  - ${key}${value.required ? '*' : ''} (${value.type || 'any'})${
            value.description ? ` - ${value.description}` : ''
          }`,
        });
      }
    }
    if (this.options.examples && plugin.examples?.length) {
      const example = plugin.examples[0];
      lines.push({
        text: `  Example${example.title ? `: ${example.title}` : ':'}`,
        tone: 'muted',
      });
      lines.push({
        text: JSON.stringify(example.props, null, 2),
        tone: 'success',
      });
    }
    return lines;
  }

  async displayGrouped(plugins: PluginMetadata[]): Promise<void> {
    const lines: UiLine[] = [
      { text: 'Custom Plugins Discovery', tone: 'info' },
    ];
    for (const location of ['upstream', 'current', 'downstream'] as const) {
      const items = plugins.filter((plugin) => plugin.location === location);
      if (items.length === 0) continue;
      lines.push({
        text: `${location.charAt(0).toUpperCase() + location.slice(1)} (${items.length}):`,
      });
      for (const plugin of items) {
        lines.push({ text: `  * ${plugin.name}`, tone: 'warning' });
        lines.push({ text: `    ${plugin.relativePath}`, tone: 'muted' });
        if (plugin.description)
          lines.push({ text: `    ${plugin.description}` });
      }
    }
    lines.push({
      text: `Total: ${plugins.length} plugin${plugins.length === 1 ? '' : 's'} discovered`,
    });
    await renderLines(lines);
  }
}
