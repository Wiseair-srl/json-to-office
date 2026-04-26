import * as path from 'path';
import * as fs from 'fs';

import type { ServicesConfig, FontRuntimeOpts } from '@json-to-office/shared';

const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
function safeThemeKey(name: string | undefined): string {
  return name && !UNSAFE_KEYS.has(name) ? name : 'custom';
}

export type FormatName = 'docx' | 'pptx';

function buildServicesFromEnv(): ServicesConfig | undefined {
  const serverUrl = process.env.HIGHCHARTS_SERVER_URL;
  const apiKey = process.env.HIGHCHARTS_API_KEY;
  const apiKeyHeader = process.env.HIGHCHARTS_API_KEY_HEADER ?? 'x-api-key';

  if (!serverUrl && !apiKey) return undefined;

  return {
    highcharts: {
      serverUrl,
      ...(apiKey && { headers: { [apiKeyHeader]: apiKey } }),
    },
  };
}

/** Minimal builder shape shared by DOCX and PPTX generators */
interface GeneratorBuilder {
  addComponent(component: any): GeneratorBuilder;
  validate(document: any): {
    valid: boolean;
    errors?: { path: string; message: string }[];
  };
  generateBuffer(document: any): Promise<{ buffer: Buffer; warnings: any }>;
  getStandardComponentsDefinition?: (document: any) => Promise<any>;
}

export interface GeneratorOptions {
  theme?: string | any;
  themePath?: string;
  customThemes?: Record<string, any>;
  validation?: {
    strict?: boolean;
    allowUnknownFields?: boolean;
  };
  fonts?: FontRuntimeOpts;
}

export interface GeneratorResult {
  generateBuffer: (document: any) => Promise<Buffer>;
  getStandardComponentsDefinition?: (config: any) => Promise<any>;
  hasPlugins: boolean;
  pluginNames: string[];
}

export interface FormatAdapter {
  name: FormatName;
  extension: string;
  label: string;
  defaultPort: number;

  generateBuffer(json: unknown, options: GeneratorOptions): Promise<Buffer>;

  createGenerator(
    plugins: any[],
    options: GeneratorOptions
  ): Promise<GeneratorResult>;

  parseJson(input: string | object): unknown;
  validateDocument(doc: unknown): { valid: boolean; errors?: any[] };

  generateSchema(options?: any): any;

  getBuiltinThemes(): Record<string, any>;
  resolveTheme(options: GeneratorOptions): Promise<any>;
  loadCustomThemes(
    options: GeneratorOptions
  ): Promise<Record<string, any> | undefined>;

  getComponentCacheStats?(): Promise<any>;
  getComponentCacheAnalytics?(): Promise<any>;
}

export class DocxFormatAdapter implements FormatAdapter {
  name: FormatName = 'docx';
  extension = '.docx';
  label = 'document';
  defaultPort = 3003;

  async generateBuffer(
    json: unknown,
    options: GeneratorOptions
  ): Promise<Buffer> {
    const core = await import('@json-to-office/core-docx');
    const docDefinition =
      typeof json === 'string' ? JSON.parse(json as string) : json;
    const customThemes = await this.loadCustomThemes(options);
    const services = buildServicesFromEnv();
    return await core.generateBufferFromJson(docDefinition as any, {
      customThemes,
      services,
      fonts: options.fonts,
    });
  }

  async createGenerator(
    plugins: any[],
    options: GeneratorOptions
  ): Promise<GeneratorResult> {
    const core = await import('@json-to-office/core-docx');
    const hasPlugins = plugins.length > 0;
    const pluginNames = plugins.map((p) => p.name);
    const services = buildServicesFromEnv();

    if (!hasPlugins) {
      return {
        generateBuffer: async (document: any) => {
          const docDefinition =
            typeof document === 'string' ? JSON.parse(document) : document;
          const customThemes = await this.loadCustomThemes(options);
          return await core.generateBufferFromJson(docDefinition, {
            customThemes,
            services,
            fonts: options.fonts,
          });
        },
        hasPlugins: false,
        pluginNames: [],
      };
    }

    const theme = await this.resolveTheme(options);
    const customThemes = await this.loadCustomThemes(options);
    let generator: GeneratorBuilder = core.createDocumentGenerator({
      theme,
      customThemes,
      debug: process.env.DEBUG === 'true',
      services,
      fonts: options.fonts,
    });

    for (const plugin of plugins) {
      generator = generator.addComponent(plugin);
    }

    return {
      generateBuffer: async (document: any) => {
        const docDefinition =
          typeof document === 'string' ? JSON.parse(document) : document;
        const validationResult = generator.validate(docDefinition);
        if (!validationResult.valid) {
          const errors = validationResult.errors || [];
          throw new Error(
            `Document validation failed:\n${errors
              .map((e: any) => `  - ${e.path}: ${e.message}`)
              .join('\n')}`
          );
        }
        const result = await generator.generateBuffer(docDefinition);
        // generateBuffer returns BufferGenerationResult { buffer, warnings }
        return result.buffer;
      },
      getStandardComponentsDefinition: generator.getStandardComponentsDefinition
        ? (config: any) => generator.getStandardComponentsDefinition!(config)
        : undefined,
      hasPlugins: true,
      pluginNames,
    };
  }

  parseJson(input: string | object): unknown {
    return typeof input === 'string' ? JSON.parse(input) : input;
  }

  validateDocument(_doc: unknown): { valid: boolean; errors?: any[] } {
    return { valid: true };
  }

  generateSchema(_options?: any): any {
    // Delegate to shared-docx
    return null;
  }

  getBuiltinThemes(): Record<string, any> {
    try {
      // Dynamic import at call time
      const core = require('@json-to-office/core-docx');
      return core.themes || {};
    } catch {
      return {};
    }
  }

  async resolveTheme(options: GeneratorOptions): Promise<any> {
    const core = await import('@json-to-office/core-docx');

    if (options.themePath) {
      try {
        if (options.themePath.endsWith('.json')) {
          return await core.loadThemeFromFile(options.themePath);
        } else {
          const themePath = path.resolve(process.cwd(), options.themePath);
          const themeModule = await import(themePath);
          return themeModule.default || themeModule.theme;
        }
      } catch (error: any) {
        console.warn(
          `Failed to load theme from ${options.themePath}: ${error.message}`
        );
      }
    }

    if (typeof options.theme === 'string') {
      const builtInTheme = (core.themes as Record<string, any>)?.[
        options.theme
      ];
      if (builtInTheme) return builtInTheme;

      if (options.theme.endsWith('.json') && fs.existsSync(options.theme)) {
        try {
          return await core.loadThemeFromFile(options.theme);
        } catch {}
      }

      try {
        return await core.loadThemeFromJson(options.theme);
      } catch {}
    }

    if (typeof options.theme === 'object' && options.theme !== null) {
      return options.theme;
    }

    return (core.themes as any)?.minimal || {};
  }

  async loadCustomThemes(
    options: GeneratorOptions
  ): Promise<Record<string, any> | undefined> {
    const core = await import('@json-to-office/core-docx');
    const customThemes: Record<string, any> = {};

    // Include themes passed directly from the client (playground UI)
    if (options.customThemes) {
      Object.assign(customThemes, options.customThemes);
    }

    if (typeof options.theme === 'object' && options.theme !== null) {
      customThemes[safeThemeKey(options.theme.name)] = options.theme;
    }

    if (options.themePath) {
      try {
        let theme: any;
        if (options.themePath.endsWith('.json')) {
          theme = await core.loadThemeFromFile(options.themePath);
        } else {
          const themePath = path.resolve(process.cwd(), options.themePath);
          const themeModule = await import(themePath);
          theme = themeModule.default || themeModule.theme;
        }
        if (theme) {
          customThemes[safeThemeKey(theme.name)] = theme;
        }
      } catch (error: any) {
        console.warn(
          `Failed to load theme from ${options.themePath}: ${error.message}`
        );
      }
    }

    return Object.keys(customThemes).length > 0 ? customThemes : undefined;
  }

  async getComponentCacheStats(): Promise<any> {
    try {
      const core = await import('@json-to-office/core-docx');
      const stats = core.getComponentCacheStats?.();
      if (!stats) return null;
      // Convert componentStats Map to serializable format matching client's ComponentCacheData
      const componentStats = Array.from(
        (stats.componentStats as Map<string, any>).entries()
      ).map(([, s]: [string, any]) => {
        const total = s.hits + s.misses;
        const hitRate = total > 0 ? s.hits / total : 0;
        return {
          type: s.name,
          hits: s.hits,
          misses: s.misses,
          avgProcessTime: s.avgProcessTime,
          avgSize: s.avgSize,
          entries: s.entries,
          hitRate,
          missRate: total > 0 ? s.misses / total : 0,
          totalRequests: total,
          memoryUsage: s.entries * s.avgSize,
          efficiencyScore: Math.round(hitRate * 100),
        };
      });
      return {
        entries: stats.entries,
        totalSize: stats.totalSize,
        hitRate: stats.hitRate,
        missRate: stats.missRate,
        totalHits: stats.totalHits,
        totalMisses: stats.totalMisses,
        avgResponseTime: stats.avgResponseTime,
        evictions: stats.evictions,
        componentStats,
      };
    } catch {
      return null;
    }
  }

  async getComponentCacheAnalytics(): Promise<any> {
    try {
      const core = await import('@json-to-office/core-docx');
      const stats = core.getComponentCacheStats?.();
      if (!stats) return null;
      const analytics = new core.ComponentCacheAnalytics();
      const report = analytics.analyzeCache(stats);
      // Remap componentMetrics field names for client compatibility
      return {
        ...report,
        componentMetrics: report.componentMetrics.map((m: any) => ({
          componentType: m.componentName,
          hitRate: m.hitRate,
          totalRequests: m.totalRequests,
          avgHitTime: m.avgHitTime,
          avgMissTime: m.avgMissTime,
          efficiencyScore: m.efficiencyScore,
          memoryUsage: m.memoryUsage,
          timeSaved: m.timeSaved,
          costBenefitRatio: m.costBenefitRatio,
        })),
        recommendations: report.recommendations.map((r: any) => ({
          componentType: r.componentName,
          type: r.type,
          description: r.description,
          expectedImprovement: r.expectedImprovement,
          priority: r.priority,
          reasoning: r.reasoning,
        })),
      };
    } catch {
      return null;
    }
  }
}

export class PptxFormatAdapter implements FormatAdapter {
  name: FormatName = 'pptx';
  extension = '.pptx';
  label = 'presentation';
  defaultPort = 3004;

  async generateBuffer(
    json: unknown,
    options: GeneratorOptions
  ): Promise<Buffer> {
    const core = await import('@json-to-office/core-pptx');
    const docDefinition =
      typeof json === 'string' ? JSON.parse(json as string) : json;
    const customThemes = await this.loadCustomThemes(options);
    const services = buildServicesFromEnv();
    return await core.generateBufferFromJson(docDefinition as any, {
      customThemes,
      services,
      fonts: options.fonts,
    });
  }

  async createGenerator(
    plugins: any[],
    options: GeneratorOptions
  ): Promise<GeneratorResult> {
    const core = await import('@json-to-office/core-pptx');
    const hasPlugins = plugins.length > 0;
    const pluginNames = plugins.map((p) => p.name);
    const services = buildServicesFromEnv();

    if (!hasPlugins) {
      return {
        generateBuffer: async (document: any) => {
          const docDefinition =
            typeof document === 'string' ? JSON.parse(document) : document;
          const customThemes = await this.loadCustomThemes(options);
          return await core.generateBufferFromJson(docDefinition, {
            customThemes,
            services,
            fonts: options.fonts,
          });
        },
        hasPlugins: false,
        pluginNames: [],
      };
    }

    const theme = await this.resolveTheme(options);
    const customThemes = await this.loadCustomThemes(options);
    let generator: GeneratorBuilder = core.createPresentationGenerator({
      theme,
      customThemes,
      debug: process.env.DEBUG === 'true',
      services,
      fonts: options.fonts,
    });

    for (const plugin of plugins) {
      generator = generator.addComponent(plugin);
    }

    return {
      generateBuffer: async (document: any) => {
        const docDefinition =
          typeof document === 'string' ? JSON.parse(document) : document;
        const validationResult = generator.validate(docDefinition);
        if (!validationResult.valid) {
          const errors = validationResult.errors || [];
          throw new Error(
            `Presentation validation failed:\n${errors
              .map((e: any) => `  - ${e.path}: ${e.message}`)
              .join('\n')}`
          );
        }
        const result = await generator.generateBuffer(docDefinition);
        return result.buffer;
      },
      hasPlugins: true,
      pluginNames,
    };
  }

  parseJson(input: string | object): unknown {
    return typeof input === 'string' ? JSON.parse(input) : input;
  }

  validateDocument(_doc: unknown): { valid: boolean; errors?: any[] } {
    return { valid: true };
  }

  generateSchema(_options?: any): any {
    return null;
  }

  getBuiltinThemes(): Record<string, any> {
    try {
      const core = require('@json-to-office/core-pptx');
      return core.pptxThemes || {};
    } catch {
      return {};
    }
  }

  async resolveTheme(options: GeneratorOptions): Promise<any> {
    const core = await import('@json-to-office/core-pptx');
    const themes = (core as any).pptxThemes || {};

    if (options.themePath) {
      try {
        if (options.themePath.endsWith('.json')) {
          const content = fs.readFileSync(
            path.resolve(process.cwd(), options.themePath),
            'utf-8'
          );
          return JSON.parse(content);
        } else {
          const themePath = path.resolve(process.cwd(), options.themePath);
          const themeModule = await import(themePath);
          return themeModule.default || themeModule.theme;
        }
      } catch (error: any) {
        console.warn(
          `Failed to load theme from ${options.themePath}: ${error.message}`
        );
      }
    }

    if (typeof options.theme === 'string') {
      const builtIn =
        themes[options.theme] || (core as any).getPptxTheme?.(options.theme);
      if (builtIn) return builtIn;

      if (options.theme.endsWith('.json') && fs.existsSync(options.theme)) {
        try {
          const content = fs.readFileSync(
            path.resolve(process.cwd(), options.theme),
            'utf-8'
          );
          return JSON.parse(content);
        } catch {}
      }
    }

    if (typeof options.theme === 'object' && options.theme !== null) {
      return options.theme;
    }

    return themes.minimal || {};
  }

  async loadCustomThemes(
    options: GeneratorOptions
  ): Promise<Record<string, any> | undefined> {
    const customThemes: Record<string, any> = {};

    // Include themes passed directly from the client (playground UI)
    if (options.customThemes) {
      Object.assign(customThemes, options.customThemes);
    }

    if (typeof options.theme === 'object' && options.theme !== null) {
      customThemes[safeThemeKey(options.theme.name)] = options.theme;
    }

    if (options.themePath) {
      try {
        let theme: any;
        if (options.themePath.endsWith('.json')) {
          const content = fs.readFileSync(
            path.resolve(process.cwd(), options.themePath),
            'utf-8'
          );
          theme = JSON.parse(content);
        } else {
          const themePath = path.resolve(process.cwd(), options.themePath);
          const themeModule = await import(themePath);
          theme = themeModule.default || themeModule.theme;
        }
        if (theme) {
          customThemes[safeThemeKey(theme.name)] = theme;
        }
      } catch (error: any) {
        console.warn(
          `Failed to load theme from ${options.themePath}: ${error.message}`
        );
      }
    }

    return Object.keys(customThemes).length > 0 ? customThemes : undefined;
  }
}

export function createAdapter(format: FormatName): FormatAdapter {
  switch (format) {
    case 'docx':
      return new DocxFormatAdapter();
    case 'pptx':
      return new PptxFormatAdapter();
    default:
      throw new Error(`Unknown format: ${format}`);
  }
}
