import * as path from 'path';
import * as fs from 'fs';

export type FormatName = 'docx' | 'pptx';

export interface GeneratorOptions {
  theme?: string | any;
  themePath?: string;
  validation?: {
    strict?: boolean;
    allowUnknownFields?: boolean;
  };
}

export interface GeneratorResult {
  generateBuffer: (document: any) => Promise<Buffer>;
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
}

export class DocxFormatAdapter implements FormatAdapter {
  name: FormatName = 'docx';
  extension = '.docx';
  label = 'document';
  defaultPort = 3003;

  async generateBuffer(json: unknown, options: GeneratorOptions): Promise<Buffer> {
    const core = await import('@json-to-office/core-docx');
    const docDefinition = typeof json === 'string' ? JSON.parse(json as string) : json;
    const customThemes = await this.loadCustomThemes(options);
    return await core.generateBufferFromJson(docDefinition as any, { customThemes });
  }

  async createGenerator(
    plugins: any[],
    options: GeneratorOptions
  ): Promise<GeneratorResult> {
    const core = await import('@json-to-office/core-docx');
    const hasPlugins = plugins.length > 0;
    const pluginNames = plugins.map((p) => p.name);

    if (!hasPlugins) {
      return {
        generateBuffer: async (document: any) => {
          const docDefinition =
            typeof document === 'string' ? JSON.parse(document) : document;
          const customThemes = await this.loadCustomThemes(options);
          return await core.generateBufferFromJson(docDefinition, { customThemes });
        },
        hasPlugins: false,
        pluginNames: [],
      };
    }

    const theme = await this.resolveTheme(options);
    // createDocumentGenerator returns a builder; add components via .addComponent()
    let generator = core.createDocumentGenerator({
      theme,
      debug: process.env.DEBUG === 'true',
    }) as any;

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

  generateSchema(options?: any): any {
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
      const builtInTheme = (core.themes as Record<string, any>)?.[options.theme];
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

    if (typeof options.theme === 'object' && options.theme !== null) {
      customThemes.custom = options.theme;
    }

    if (options.themePath) {
      try {
        if (options.themePath.endsWith('.json')) {
          customThemes.custom = await core.loadThemeFromFile(options.themePath);
        } else {
          const themePath = path.resolve(process.cwd(), options.themePath);
          const themeModule = await import(themePath);
          customThemes.custom = themeModule.default || themeModule.theme;
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

export class PptxFormatAdapter implements FormatAdapter {
  name: FormatName = 'pptx';
  extension = '.pptx';
  label = 'presentation';
  defaultPort = 3004;

  async generateBuffer(json: unknown, options: GeneratorOptions): Promise<Buffer> {
    const core = await import('@json-to-office/core-pptx');
    const docDefinition = typeof json === 'string' ? JSON.parse(json as string) : json;
    const customThemes = await this.loadCustomThemes(options);
    return await core.generateBufferFromJson(docDefinition as any, { customThemes });
  }

  async createGenerator(
    plugins: any[],
    options: GeneratorOptions
  ): Promise<GeneratorResult> {
    const core = await import('@json-to-office/core-pptx');
    const hasPlugins = plugins.length > 0;
    const pluginNames = plugins.map((p) => p.name);

    return {
      generateBuffer: async (document: any) => {
        const docDefinition =
          typeof document === 'string' ? JSON.parse(document) : document;
        const customThemes = await this.loadCustomThemes(options);
        return await core.generateBufferFromJson(docDefinition, { customThemes });
      },
      hasPlugins,
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

    if (typeof options.theme === 'object' && options.theme !== null) {
      customThemes.custom = options.theme;
    }

    if (options.themePath) {
      try {
        if (options.themePath.endsWith('.json')) {
          const content = fs.readFileSync(
            path.resolve(process.cwd(), options.themePath),
            'utf-8'
          );
          customThemes.custom = JSON.parse(content);
        } else {
          const themePath = path.resolve(process.cwd(), options.themePath);
          const themeModule = await import(themePath);
          customThemes.custom = themeModule.default || themeModule.theme;
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
