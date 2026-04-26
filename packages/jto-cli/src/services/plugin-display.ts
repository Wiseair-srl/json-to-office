import chalk from 'chalk';
import type { PluginMetadata } from './plugin-metadata.js';

export interface DisplayOptions {
  json?: boolean;
  schema?: boolean;
  examples?: boolean;
  verbose?: boolean;
}

export class PluginDisplay {
  private options: DisplayOptions;

  constructor(options: DisplayOptions = {}) {
    this.options = options;
  }

  async show(plugins: PluginMetadata[]): Promise<void> {
    if (this.options.json) {
      this.displayJson(plugins);
    } else {
      this.displayConsole(plugins);
    }
  }

  private displayJson(plugins: PluginMetadata[]): void {
    const output: any = {
      plugins: plugins.map((plugin) => this.formatPluginForJson(plugin)),
      count: plugins.length,
      locations: {
        upstream: plugins.filter((p) => p.location === 'upstream').length,
        current: plugins.filter((p) => p.location === 'current').length,
        downstream: plugins.filter((p) => p.location === 'downstream').length,
      },
    };

    console.log(JSON.stringify(output, null, 2));
  }

  private formatPluginForJson(plugin: PluginMetadata): any {
    const formatted: any = {
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

    if (this.options.examples && plugin.examples) {
      formatted.examples = plugin.examples;
    }

    return formatted;
  }

  private displayConsole(plugins: PluginMetadata[]): void {
    console.log();
    console.log(chalk.bold.cyan('Custom Plugins Discovery'));
    console.log(chalk.gray('-'.repeat(50)));
    console.log();

    const upstream = plugins.filter((p) => p.location === 'upstream');
    const current = plugins.filter((p) => p.location === 'current');
    const downstream = plugins.filter((p) => p.location === 'downstream');

    console.log(chalk.bold('Search Results:'));
    if (upstream.length > 0) {
      console.log(
        chalk.gray('  Upstream:  ') +
          chalk.green(
            `${upstream.length} plugin${upstream.length !== 1 ? 's' : ''} found`
          )
      );
    }
    if (current.length > 0) {
      console.log(
        chalk.gray('  Current:   ') +
          chalk.green(
            `${current.length} plugin${current.length !== 1 ? 's' : ''} found`
          )
      );
    }
    if (downstream.length > 0) {
      console.log(
        chalk.gray('  Downstream:') +
          chalk.green(
            `${downstream.length} plugin${downstream.length !== 1 ? 's' : ''} found`
          )
      );
    }
    console.log();

    if (plugins.length === 0) {
      console.log(chalk.yellow('No plugins found.'));
      console.log(
        chalk.gray(
          'Make sure your custom components follow the *.component.ts naming convention.'
        )
      );
      return;
    }

    plugins.forEach((plugin, index) => {
      if (index > 0) console.log();
      this.displayPlugin(plugin);
    });

    console.log();
    console.log(chalk.gray('-'.repeat(50)));
    console.log(
      chalk.bold(
        `Total: ${plugins.length} plugin${plugins.length !== 1 ? 's' : ''} discovered`
      )
    );
  }

  private displayPlugin(plugin: PluginMetadata): void {
    console.log(chalk.bold.yellow(`  ${plugin.name}`));

    const locationIcon = {
      upstream: '^',
      current: '*',
      downstream: 'v',
    }[plugin.location];

    console.log(
      chalk.gray(`   ${locationIcon} Path: `) + chalk.blue(plugin.relativePath)
    );

    if (plugin.description) {
      console.log(chalk.gray('   Description: ') + plugin.description);
    }

    if (plugin.version) {
      console.log(chalk.gray('   Version: ') + plugin.version);
    }

    if (this.options.schema && plugin.schema.properties) {
      console.log();
      console.log(chalk.gray('   Schema Properties:'));
      for (const [key, prop] of Object.entries(plugin.schema.properties)) {
        const required = (prop as any).required ? chalk.red('*') : '';
        const type = chalk.cyan((prop as any).type || 'any');
        let line = `   - ${key}${required} (${type})`;
        if ((prop as any).description) {
          line += chalk.gray(` - ${(prop as any).description}`);
        }
        console.log(line);
      }
    }

    if (
      this.options.examples &&
      plugin.examples &&
      plugin.examples.length > 0
    ) {
      console.log();
      console.log(chalk.gray('   Example:'));
      const example = plugin.examples[0];
      if (example.title) {
        console.log(chalk.gray(`   ${example.title}`));
      }
      const exampleJson = JSON.stringify(example.props, null, 2);
      const indentedJson = exampleJson
        .split('\n')
        .map((line) => '   ' + line)
        .join('\n');
      console.log(chalk.green(indentedJson));
    }
  }

  displayGrouped(plugins: PluginMetadata[]): void {
    const grouped = {
      upstream: plugins.filter((p) => p.location === 'upstream'),
      current: plugins.filter((p) => p.location === 'current'),
      downstream: plugins.filter((p) => p.location === 'downstream'),
    };

    console.log();
    console.log(chalk.bold.cyan('Custom Plugins Discovery'));
    console.log(chalk.gray('-'.repeat(50)));

    for (const [location, locationPlugins] of Object.entries(grouped)) {
      if (locationPlugins.length === 0) continue;

      console.log();
      console.log(
        chalk.bold(
          `${location.charAt(0).toUpperCase() + location.slice(1)} (${locationPlugins.length}):`
        )
      );
      console.log();

      locationPlugins.forEach((plugin) => {
        console.log(`  ${chalk.yellow('*')} ${chalk.bold(plugin.name)}`);
        console.log(`    ${chalk.gray(plugin.relativePath)}`);
        if (plugin.description) {
          console.log(`    ${chalk.italic(plugin.description)}`);
        }
      });
    }

    console.log();
    console.log(chalk.gray('-'.repeat(50)));
    console.log(
      chalk.bold(
        `Total: ${plugins.length} plugin${plugins.length !== 1 ? 's' : ''} discovered`
      )
    );
  }
}
