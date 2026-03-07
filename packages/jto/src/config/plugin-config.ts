import * as fs from 'fs/promises';
import * as path from 'path';
import { cosmiconfig } from 'cosmiconfig';

export interface PluginConfig {
  plugins?: string[];
  pluginDirs?: string[];
  autoDiscover?: boolean;
  aliases?: Record<string, string>;
  theme?: string | any;
  themePath?: string;
  discovery?: {
    maxDepth?: number;
    includeNodeModules?: boolean;
    upstreamOnly?: boolean;
    downstreamOnly?: boolean;
  };
  validation?: {
    strict?: boolean;
    allowUnknownFields?: boolean;
  };
}

export class PluginConfigService {
  private static instance: PluginConfigService;
  private config: PluginConfig | null = null;
  private configPath: string | null = null;

  private static readonly CONFIG_FILES = [
    '.json-to-office.config.json',
    '.json-to-office.config.js',
    'json-to-office.config.json',
    'json-to-office.config.js',
    '.json-to-officerc',
    '.json-to-officerc.json',
    '.json-to-officerc.js',
    // Legacy support
    '.json-to-docx.config.json',
    '.json-to-docx.config.js',
    'json-to-docx.config.json',
    '.json-to-pptx.config.json',
    '.json-to-pptx.config.js',
    'json-to-pptx.config.json',
  ];

  private constructor() {}

  static getInstance(): PluginConfigService {
    if (!PluginConfigService.instance) {
      PluginConfigService.instance = new PluginConfigService();
    }
    return PluginConfigService.instance;
  }

  async loadConfig(startPath?: string): Promise<PluginConfig | null> {
    try {
      const explorer = cosmiconfig('json-to-office', {
        searchPlaces: PluginConfigService.CONFIG_FILES,
        stopDir: path.parse(startPath || process.cwd()).root,
      });

      const result = await explorer.search(startPath);

      if (result) {
        this.config = result.config as PluginConfig;
        this.configPath = result.filepath;
        return this.config;
      }
    } catch (error: any) {
      console.warn(`Failed to load configuration: ${error.message}`);
    }

    const packageConfig = await this.loadFromPackageJson(startPath);
    if (packageConfig) {
      this.config = packageConfig;
      return this.config;
    }

    return null;
  }

  private async loadFromPackageJson(
    startPath?: string
  ): Promise<PluginConfig | null> {
    try {
      const packagePath = path.join(startPath || process.cwd(), 'package.json');
      const packageContent = await fs.readFile(packagePath, 'utf-8');
      const packageJson = JSON.parse(packageContent);

      // Check for json-to-office, json-to-docx, or json-to-pptx keys
      const config =
        packageJson['json-to-office'] ||
        packageJson['json-to-docx'] ||
        packageJson['json-to-pptx'];

      if (config) {
        this.configPath = packagePath;
        return config as PluginConfig;
      }
    } catch {}

    return null;
  }

  getConfig(): PluginConfig | null {
    return this.config;
  }

  getConfigPath(): string | null {
    return this.configPath;
  }

  mergeWithOptions(options: Partial<PluginConfig>): PluginConfig {
    const base = this.config || {};

    return {
      ...base,
      ...options,
      discovery: {
        ...base.discovery,
        ...options.discovery,
      },
      validation: {
        ...base.validation,
        ...options.validation,
      },
      plugins: this.mergeArrays(base.plugins, options.plugins),
      pluginDirs: this.mergeArrays(base.pluginDirs, options.pluginDirs),
      aliases: {
        ...base.aliases,
        ...options.aliases,
      },
    };
  }

  private mergeArrays(arr1?: string[], arr2?: string[]): string[] | undefined {
    if (!arr1 && !arr2) return undefined;
    if (!arr1) return arr2;
    if (!arr2) return arr1;
    return Array.from(new Set([...arr1, ...arr2]));
  }

  resolveAlias(name: string): string {
    if (this.config?.aliases && this.config.aliases[name]) {
      return this.config.aliases[name];
    }
    return name;
  }

  getConfiguredPlugins(): string[] {
    return this.config?.plugins || [];
  }

  getPluginDirectories(): string[] {
    const dirs = this.config?.pluginDirs || [];

    if (this.configPath) {
      const configDir = path.dirname(this.configPath);
      return dirs.map((dir) => {
        if (path.isAbsolute(dir)) return dir;
        return path.resolve(configDir, dir);
      });
    }

    return dirs.map((dir) => path.resolve(process.cwd(), dir));
  }

  isAutoDiscoverEnabled(): boolean {
    return this.config?.autoDiscover ?? false;
  }

  async saveConfig(config: PluginConfig, filePath?: string): Promise<void> {
    const targetPath =
      filePath ||
      this.configPath ||
      path.join(process.cwd(), '.json-to-office.config.json');

    const content = JSON.stringify(config, null, 2);
    await fs.writeFile(targetPath, content, 'utf-8');

    this.config = config;
    this.configPath = targetPath;
  }

  async createDefaultConfig(filePath?: string): Promise<void> {
    const defaultConfig: PluginConfig = {
      plugins: [],
      pluginDirs: ['./plugins', './custom-components'],
      autoDiscover: false,
      aliases: {},
      theme: 'minimal',
      discovery: {
        maxDepth: 5,
        includeNodeModules: false,
      },
      validation: {
        strict: false,
        allowUnknownFields: true,
      },
    };

    await this.saveConfig(defaultConfig, filePath);
  }

  clearConfig(): void {
    this.config = null;
    this.configPath = null;
  }
}
