import * as path from 'path';
import * as fs from 'fs';

import type {
  ServicesConfig,
  FontRuntimeOpts,
  PptxRasterizer,
  PptxBatchRasterizer,
  GenerationWarning,
} from '@json-to-office/shared';
import { validatePresentationDocument } from '@json-to-office/shared-pptx';
import { validate as validateDocx } from '@json-to-office/shared-docx';
import {
  createLibreOfficePptxRasterizer,
  createLibreOfficePptxBatchRasterizer,
} from './pptx-rasterizer.js';
import { emitDiagnostic } from './services/diagnostics.js';

/** Forward structured warnings collected during generation to the terminal. */
function emitGenerationWarnings(warnings: GenerationWarning[]): void {
  for (const warning of warnings) {
    emitDiagnostic(
      `${warning.component}: ${warning.message}`,
      warning.severity === 'info' ? 'info' : 'warning'
    );
  }
}

/**
 * Normalize a core's warning array into the single client/CLI-facing shape.
 *
 * DOCX cores already emit `GenerationWarning`; PPTX cores emit
 * `PipelineWarning = {code, message, component?, slide?}` — no `severity` and
 * an optional `component`. Left raw, a PipelineWarning renders as an empty
 * component chip in the playground's WarningsPanel, so both shapes funnel
 * through here and come out self-describing.
 */
function toGenerationWarnings(
  raw: readonly any[] | null | undefined
): GenerationWarning[] {
  return (raw ?? []).map((w) => ({
    component: w?.component ?? 'pptx',
    message: String(w?.message ?? ''),
    severity: (w?.severity === 'info' ? 'info' : 'warning') as
      | 'warning'
      | 'info',
    context: {
      ...(w?.context && typeof w.context === 'object' ? w.context : {}),
      ...(w?.code !== undefined && { code: w.code }),
      ...(w?.slide !== undefined && { slide: w.slide }),
    },
  }));
}

const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
function safeThemeKey(name: string | undefined): string {
  return name && !UNSAFE_KEYS.has(name) ? name : 'custom';
}

/** Key the theme named by `--theme`/`--theme-path` is registered under. */
const CLI_THEME_KEY = 'jto-cli-theme';

/**
 * Point a document at the explicitly requested theme. The JSON path selects a
 * theme by name off `props.theme`, so `--theme`/`--theme-path` is applied by
 * registering the resolved theme under a reserved key and rewriting the
 * reference — an explicit theme wins over the document's own `props.theme`.
 * With no theme requested the document is passed through untouched.
 */
function withRequestedTheme(
  document: any,
  theme: any | undefined,
  customThemes: Record<string, any> | undefined
): { document: any; customThemes: Record<string, any> | undefined } {
  if (!theme || typeof document !== 'object' || document === null) {
    return { document, customThemes };
  }
  return {
    document: {
      ...document,
      props: { ...document.props, theme: CLI_THEME_KEY },
    },
    customThemes: { ...customThemes, [CLI_THEME_KEY]: theme },
  };
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

// Lazily-constructed LibreOffice rasterizers, shared across docx generations.
// Constructing them is cheap (no binaries touched); they only spawn
// LibreOffice when a document actually contains a `visual` component. Single
// and batch share the same content-addressed disk cache.
let cachedRasterizer: PptxRasterizer | undefined;
function getPptxRasterizer(): PptxRasterizer {
  if (!cachedRasterizer) {
    cachedRasterizer = createLibreOfficePptxRasterizer();
  }
  return cachedRasterizer;
}
let cachedBatchRasterizer: PptxBatchRasterizer | undefined;
function getPptxBatchRasterizer(): PptxBatchRasterizer {
  if (!cachedBatchRasterizer) {
    cachedBatchRasterizer = createLibreOfficePptxBatchRasterizer();
  }
  return cachedBatchRasterizer;
}

/**
 * Services for docx generation: highcharts (from env) plus the pptx rasterizer
 * that backs `visual` components. An explicit HIGHCHARTS-style override is not
 * needed for pptx — a running rasterization server can be pointed at via
 * `services.pptx.serverUrl`, but the default is the in-process LibreOffice
 * renderer.
 */
function buildDocxServices(): ServicesConfig {
  const base = buildServicesFromEnv() ?? {};
  const serverUrl = process.env.JTO_PPTX_RASTERIZER_URL?.trim();
  const apiKey =
    process.env.JTO_PPTX_RASTERIZER_API_KEY || process.env.HIGHCHARTS_API_KEY;
  const apiKeyHeader =
    process.env.JTO_PPTX_RASTERIZER_API_KEY_HEADER ||
    process.env.HIGHCHARTS_API_KEY_HEADER ||
    'x-api-key';
  return {
    ...base,
    pptx: serverUrl
      ? {
          serverUrl,
          ...(apiKey && { headers: { [apiKeyHeader]: apiKey } }),
        }
      : {
          render: getPptxRasterizer(),
          renderBatch: getPptxBatchRasterizer(),
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
  generateBuffer(
    document: any,
    options?: {
      deterministic?: boolean;
      generatedAt?: string | Date;
      validation?: { allowUnknownFields?: boolean };
      baseDir?: string;
      renderer?: string;
    }
  ): Promise<{ buffer: Buffer; warnings: any }>;
  /**
   * Cheap standard-definition path: expansion + normalization only, no
   * rendering (DOCX generators expose it; PPTX ones may not).
   */
  expandStandardDefinition?: (
    document: any,
    options?: { validation?: { allowUnknownFields?: boolean } }
  ) => Promise<{ standardDefinition: any; warnings: any }>;
}

/**
 * Each format's renderer-id union, read from its core without importing it.
 *
 * `typeof import(...)` is a type query — erased at compile time — so this keeps
 * the ids honest while the cores stay dynamically loaded. `GeneratorOptions`
 * carries a bare string because one options bag serves both formats; these are
 * what it narrows to at each call site, and an id outside the union is rejected
 * by the core's registry with the list of valid ones.
 */
type DocxRendererId =
  (typeof import('@json-to-office/core-docx'))['DEFAULT_DOCX_RENDERER_ID'];
type PptxRendererId =
  (typeof import('@json-to-office/core-pptx'))['DEFAULT_PPTX_RENDERER_ID'];

export interface GeneratorOptions {
  theme?: string | any;
  themePath?: string;
  customThemes?: Record<string, any>;
  validation?: {
    strict?: boolean;
    allowUnknownFields?: boolean;
  };
  fonts?: FontRuntimeOpts;
  deterministic?: boolean;
  generatedAt?: string | Date;
  /**
   * Directory that relative asset paths in the document resolve against —
   * normally the input document's own directory (#142).
   */
  baseDir?: string;
  /**
   * Backend that turns the compiled document into bytes.
   *
   * Format-specific and validated by the core's renderer registry, which is
   * why this is a bare string here: naming the id union would make this
   * package import both cores statically, and they are loaded on demand.
   * Undefined means the format's default (`docxjs` / `pptxgenjs`).
   */
  renderer?: string;
  /**
   * Optional sink for structured generation warnings (FONT_UNRESOLVED and
   * friends). Mirrors core-docx's `JsonGenerationOptions.warnings`, and is the
   * only delivery mechanism that works off the CLI: `emitGenerationWarnings`
   * routes through an AsyncLocalStorage sink that is a no-op on the server.
   *
   * Adapters PUSH into it; they never replace it. Warnings therefore
   * ACCUMULATE across repeated `generateBuffer` calls on one
   * `GeneratorResult` — allocate one array per logical request.
   */
  warnings?: GenerationWarning[];
}

export interface GeneratorResult {
  generateBuffer: (document: any) => Promise<Buffer>;
  /**
   * Post-expansion standard JSON tree without any rendering work — no fonts,
   * no layout, no visual rasterization. Present when the underlying generator
   * supports it (plugin-aware DOCX generation does).
   */
  getStandardDefinition?: (config: any) => Promise<any>;
  hasPlugins: boolean;
  pluginNames: string[];
  /**
   * Identity of the theme this generator forces on every document, or
   * undefined when nothing was requested and each document's own `props.theme`
   * decides. Reported by the CLI so the summary names what actually rendered.
   */
  themeLabel?: string;
}

/** One resolution of `theme`/`themePath`, shared by every consumer of a run. */
interface ResolvedThemes {
  /**
   * The theme named by `theme`/`themePath`, or undefined when neither is set
   * or resolves — callers that must not override the document's own
   * `props.theme` depend on that distinction.
   */
  requested: any | undefined;
  /** Themes registered by name for `props.theme` lookups. */
  customThemes: Record<string, any> | undefined;
  /** What to call `requested`; undefined when the document decides. */
  label: string | undefined;
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

  /**
   * Renderer ids this format registers, defaults first.
   *
   * Async because the core that owns the registry is imported on demand — the
   * list is read from it rather than repeated here, so the two cannot drift.
   */
  rendererIds(): Promise<readonly string[]>;

  /** Cumulative visual pre-pass dedupe counters (DOCX only) (#156). */
  getVisualPrepassStats?(): Promise<any>;
  /** Reset per-format cache observability counters (DOCX only). */
  resetCacheStats?(): Promise<void>;
}

export class DocxFormatAdapter implements FormatAdapter {
  name: FormatName = 'docx';
  extension = '.docx';
  label = 'document';
  defaultPort = 3003;

  async rendererIds(): Promise<readonly string[]> {
    const core = await import('@json-to-office/core-docx');
    return core.docxRendererIds();
  }

  async generateBuffer(
    json: unknown,
    options: GeneratorOptions
  ): Promise<Buffer> {
    const core = await import('@json-to-office/core-docx');
    const parsed = typeof json === 'string' ? JSON.parse(json as string) : json;
    const resolved = await this.resolveThemes(options);
    const { document: docDefinition, customThemes } = withRequestedTheme(
      parsed,
      resolved.requested,
      resolved.customThemes
    );
    const services = buildDocxServices();
    // Collect rather than swallow: without a sink, core warnings (an
    // unresolvable `props.theme` among them) never reach the terminal and the
    // render just comes back looking subtly wrong.
    const warnings: GenerationWarning[] = [];
    const buffer = await core.generateBufferFromJson(docDefinition as any, {
      customThemes,
      services,
      fonts: options.fonts,
      validation: {
        allowUnknownFields: options.validation?.allowUnknownFields,
      },
      deterministic: options.deterministic,
      generatedAt: options.generatedAt,
      baseDir: options.baseDir,
      renderer: options.renderer as DocxRendererId | undefined,
      warnings,
    });
    emitGenerationWarnings(warnings);
    options.warnings?.push(...toGenerationWarnings(warnings));
    return buffer;
  }

  async createGenerator(
    plugins: any[],
    options: GeneratorOptions
  ): Promise<GeneratorResult> {
    const core = await import('@json-to-office/core-docx');
    const hasPlugins = plugins.length > 0;
    const pluginNames = plugins.map((p) => p.name);
    const services = buildDocxServices();

    // Resolved once: repeating it per document would repeat the file read and
    // any unknown-theme warning that comes with it.
    const {
      requested: requestedTheme,
      customThemes,
      label: themeLabel,
    } = await this.resolveThemes(options);

    if (!hasPlugins) {
      return {
        generateBuffer: async (document: any) => {
          const parsed =
            typeof document === 'string' ? JSON.parse(document) : document;
          const { document: docDefinition, customThemes: themes } =
            withRequestedTheme(parsed, requestedTheme, customThemes);
          const warnings: GenerationWarning[] = [];
          const buffer = await core.generateBufferFromJson(docDefinition, {
            customThemes: themes,
            services,
            fonts: options.fonts,
            validation: {
              allowUnknownFields: options.validation?.allowUnknownFields,
            },
            deterministic: options.deterministic,
            generatedAt: options.generatedAt,
            baseDir: options.baseDir,
            renderer: options.renderer as DocxRendererId | undefined,
            warnings,
          });
          emitGenerationWarnings(warnings);
          options.warnings?.push(...toGenerationWarnings(warnings));
          return buffer;
        },
        hasPlugins: false,
        pluginNames: [],
        themeLabel,
      };
    }

    let generator: GeneratorBuilder = core.createDocumentGenerator({
      // Undefined when nothing was requested: a constructor theme beats the
      // generator's own `props.theme` lookup, so forcing one here would render
      // every document in it.
      theme: requestedTheme,
      customThemes: requestedTheme
        ? { ...customThemes, [CLI_THEME_KEY]: requestedTheme }
        : customThemes,
      debug: process.env.DEBUG === 'true',
      services,
      fonts: options.fonts,
      validation: {
        allowUnknownFields: options.validation?.allowUnknownFields,
      },
      deterministic: options.deterministic,
      generatedAt: options.generatedAt,
      baseDir: options.baseDir,
      renderer: options.renderer as DocxRendererId | undefined,
    });

    for (const plugin of plugins) {
      generator = generator.addComponent(plugin);
    }

    return {
      generateBuffer: async (document: any) => {
        const parsed =
          typeof document === 'string' ? JSON.parse(document) : document;
        const { document: docDefinition } = withRequestedTheme(
          parsed,
          requestedTheme,
          customThemes
        );
        const result = await generator.generateBuffer(docDefinition, {
          validation: {
            allowUnknownFields: options.validation?.allowUnknownFields,
          },
          deterministic: options.deterministic,
          generatedAt: options.generatedAt,
          baseDir: options.baseDir,
          renderer: options.renderer as DocxRendererId | undefined,
        });
        emitGenerationWarnings(result.warnings ?? []);
        options.warnings?.push(...toGenerationWarnings(result.warnings));
        return result.buffer;
      },
      getStandardDefinition: generator.expandStandardDefinition
        ? async (config: any) => {
            const parsed =
              typeof config === 'string' ? JSON.parse(config) : config;
            const { document: docDefinition } = withRequestedTheme(
              parsed,
              requestedTheme,
              customThemes
            );
            const result = await generator.expandStandardDefinition!(
              docDefinition,
              {
                validation: {
                  allowUnknownFields: options.validation?.allowUnknownFields,
                },
              }
            );
            emitGenerationWarnings(result.warnings ?? []);
            return result.standardDefinition;
          }
        : undefined,
      hasPlugins: true,
      pluginNames,
      themeLabel,
    };
  }

  parseJson(input: string | object): unknown {
    return typeof input === 'string' ? JSON.parse(input) : input;
  }

  validateDocument(doc: unknown): { valid: boolean; errors?: any[] } {
    const result = validateDocx.jsonDocument(doc as object);
    return {
      valid: result.valid,
      ...(result.errors.length > 0 && { errors: result.errors }),
    };
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
    const { requested } = await this.resolveThemes(options);
    return requested ?? (core.themes as any)?.minimal ?? {};
  }

  /**
   * Resolve `theme`/`themePath` once for a whole run: `themePath` is read a
   * single time and feeds both the requested theme and the custom-theme
   * registry, so a bad path warns once instead of once per consumer.
   */
  private async resolveThemes(
    options: GeneratorOptions
  ): Promise<ResolvedThemes> {
    const core = await import('@json-to-office/core-docx');
    // Themes passed directly from the client (playground UI) come first.
    const registry: Record<string, any> = { ...options.customThemes };

    if (typeof options.theme === 'object' && options.theme !== null) {
      registry[safeThemeKey(options.theme.name)] = options.theme;
    }

    let fileTheme: any | undefined;
    if (options.themePath) {
      try {
        if (options.themePath.endsWith('.json')) {
          fileTheme = await core.loadThemeFromFile(options.themePath);
        } else {
          const themePath = path.resolve(process.cwd(), options.themePath);
          const themeModule = await import(themePath);
          fileTheme = themeModule.default || themeModule.theme;
        }
      } catch (error: any) {
        emitDiagnostic(
          `Failed to load theme from ${options.themePath}: ${error.message}`,
          'warning'
        );
      }
      if (fileTheme) {
        registry[safeThemeKey(fileTheme.name)] = fileTheme;
      }
    }

    const customThemes =
      Object.keys(registry).length > 0 ? registry : undefined;

    if (fileTheme) {
      return { requested: fileTheme, customThemes, label: options.themePath };
    }

    if (typeof options.theme === 'string') {
      const named =
        options.customThemes?.[options.theme] ??
        (core.themes as Record<string, any>)?.[options.theme];
      if (named)
        return { requested: named, customThemes, label: options.theme };

      if (options.theme.endsWith('.json') && fs.existsSync(options.theme)) {
        try {
          return {
            requested: await core.loadThemeFromFile(options.theme),
            customThemes,
            label: options.theme,
          };
        } catch {}
      }

      try {
        const inline = await core.loadThemeFromJson(options.theme);
        return {
          requested: inline,
          customThemes,
          label: (inline as any)?.name || options.theme,
        };
      } catch {}

      emitDiagnostic(
        `Unknown theme "${options.theme}"; keeping the document's own theme`,
        'warning'
      );
    }

    if (typeof options.theme === 'object' && options.theme !== null) {
      return {
        requested: options.theme,
        customThemes,
        label: safeThemeKey(options.theme.name),
      };
    }

    return { requested: undefined, customThemes, label: undefined };
  }

  async loadCustomThemes(
    options: GeneratorOptions
  ): Promise<Record<string, any> | undefined> {
    return (await this.resolveThemes(options)).customThemes;
  }

  async getVisualPrepassStats(): Promise<any> {
    try {
      const core = await import('@json-to-office/core-docx');
      return core.getVisualPrepassStats?.() ?? null;
    } catch {
      return null;
    }
  }

  async resetCacheStats(): Promise<void> {
    try {
      const core = await import('@json-to-office/core-docx');
      core.resetVisualPrepassStats?.();
    } catch {
      // Resetting observability is best-effort.
    }
  }
}

export class PptxFormatAdapter implements FormatAdapter {
  name: FormatName = 'pptx';
  extension = '.pptx';
  label = 'presentation';
  defaultPort = 3004;

  async rendererIds(): Promise<readonly string[]> {
    const core = await import('@json-to-office/core-pptx');
    return core.pptxRendererIds();
  }

  async generateBuffer(
    json: unknown,
    options: GeneratorOptions
  ): Promise<Buffer> {
    const core = await import('@json-to-office/core-pptx');
    const parsed = typeof json === 'string' ? JSON.parse(json as string) : json;
    const resolved = await this.resolveThemes(options);
    const { document: docDefinition, customThemes } = withRequestedTheme(
      parsed,
      resolved.requested,
      resolved.customThemes
    );
    const services = buildServicesFromEnv();
    // The warnings-returning entry point: `generateBufferFromJson` allocates
    // the pipeline's warning array internally and throws it away, so core
    // warnings (FONT_UNRESOLVED among them) never reached the terminal or the
    // server.
    const result = await core.generateBufferWithWarnings(docDefinition as any, {
      customThemes,
      services,
      fonts: options.fonts,
      validation: {
        allowUnknownFields: options.validation?.allowUnknownFields,
      },
      deterministic: options.deterministic,
      generatedAt: options.generatedAt,
      baseDir: options.baseDir,
      renderer: options.renderer as PptxRendererId | undefined,
    });
    const normalized = toGenerationWarnings(result.warnings);
    emitGenerationWarnings(normalized);
    options.warnings?.push(...normalized);
    return result.buffer;
  }

  async createGenerator(
    plugins: any[],
    options: GeneratorOptions
  ): Promise<GeneratorResult> {
    const core = await import('@json-to-office/core-pptx');
    const hasPlugins = plugins.length > 0;
    const pluginNames = plugins.map((p) => p.name);
    const services = buildServicesFromEnv();

    // Resolved once: repeating it per document would repeat the file read and
    // any unknown-theme warning that comes with it.
    const {
      requested: requestedTheme,
      customThemes,
      label: themeLabel,
    } = await this.resolveThemes(options);

    if (!hasPlugins) {
      return {
        generateBuffer: async (document: any) => {
          const parsed =
            typeof document === 'string' ? JSON.parse(document) : document;
          const { document: docDefinition, customThemes: themes } =
            withRequestedTheme(parsed, requestedTheme, customThemes);
          const result = await core.generateBufferWithWarnings(docDefinition, {
            customThemes: themes,
            services,
            fonts: options.fonts,
            validation: {
              allowUnknownFields: options.validation?.allowUnknownFields,
            },
            deterministic: options.deterministic,
            generatedAt: options.generatedAt,
            baseDir: options.baseDir,
            renderer: options.renderer as PptxRendererId | undefined,
          });
          const normalized = toGenerationWarnings(result.warnings);
          emitGenerationWarnings(normalized);
          options.warnings?.push(...normalized);
          return result.buffer;
        },
        hasPlugins: false,
        pluginNames: [],
        themeLabel,
      };
    }

    let generator: GeneratorBuilder = core.createPresentationGenerator({
      // Undefined when nothing was requested: a constructor theme beats the
      // generator's own `props.theme` lookup, so forcing one here would render
      // every document in it.
      theme: requestedTheme,
      customThemes: requestedTheme
        ? { ...customThemes, [CLI_THEME_KEY]: requestedTheme }
        : customThemes,
      debug: process.env.DEBUG === 'true',
      services,
      fonts: options.fonts,
      validation: {
        allowUnknownFields: options.validation?.allowUnknownFields,
      },
      deterministic: options.deterministic,
      generatedAt: options.generatedAt,
      baseDir: options.baseDir,
      renderer: options.renderer as PptxRendererId | undefined,
    });

    for (const plugin of plugins) {
      generator = generator.addComponent(plugin);
    }

    return {
      generateBuffer: async (document: any) => {
        const parsed =
          typeof document === 'string' ? JSON.parse(document) : document;
        const { document: docDefinition } = withRequestedTheme(
          parsed,
          requestedTheme,
          customThemes
        );
        const result = await generator.generateBuffer(docDefinition, {
          validation: {
            allowUnknownFields: options.validation?.allowUnknownFields,
          },
          deterministic: options.deterministic,
          generatedAt: options.generatedAt,
          baseDir: options.baseDir,
          renderer: options.renderer as PptxRendererId | undefined,
        });
        const normalized = toGenerationWarnings(result.warnings);
        emitGenerationWarnings(normalized);
        options.warnings?.push(...normalized);
        return result.buffer;
      },
      hasPlugins: true,
      pluginNames,
      themeLabel,
    };
  }

  parseJson(input: string | object): unknown {
    return typeof input === 'string' ? JSON.parse(input) : input;
  }

  validateDocument(doc: unknown): { valid: boolean; errors?: any[] } {
    const result = validatePresentationDocument(doc);
    return {
      valid: result.valid,
      ...(result.errors.length > 0 && { errors: result.errors }),
    };
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
    const { requested } = await this.resolveThemes(options);
    return requested ?? themes.minimal ?? {};
  }

  /**
   * Resolve `theme`/`themePath` once for a whole run: `themePath` is read a
   * single time and feeds both the requested theme and the custom-theme
   * registry, so a bad path warns once instead of once per consumer.
   */
  private async resolveThemes(
    options: GeneratorOptions
  ): Promise<ResolvedThemes> {
    const core = await import('@json-to-office/core-pptx');
    const themes = (core as any).pptxThemes || {};
    // Themes passed directly from the client (playground UI) come first.
    const registry: Record<string, any> = { ...options.customThemes };

    if (typeof options.theme === 'object' && options.theme !== null) {
      registry[safeThemeKey(options.theme.name)] = options.theme;
    }

    let fileTheme: any | undefined;
    if (options.themePath) {
      try {
        if (options.themePath.endsWith('.json')) {
          const content = fs.readFileSync(
            path.resolve(process.cwd(), options.themePath),
            'utf-8'
          );
          fileTheme = JSON.parse(content);
        } else {
          const themePath = path.resolve(process.cwd(), options.themePath);
          const themeModule = await import(themePath);
          fileTheme = themeModule.default || themeModule.theme;
        }
      } catch (error: any) {
        emitDiagnostic(
          `Failed to load theme from ${options.themePath}: ${error.message}`,
          'warning'
        );
      }
      if (fileTheme) {
        registry[safeThemeKey(fileTheme.name)] = fileTheme;
      }
    }

    const customThemes =
      Object.keys(registry).length > 0 ? registry : undefined;

    if (fileTheme) {
      return { requested: fileTheme, customThemes, label: options.themePath };
    }

    if (typeof options.theme === 'string') {
      // Deliberately not getPptxTheme(): it answers every unknown name with
      // the default theme, which would silently swap a typo'd `--theme` in
      // over the document's own.
      const named =
        options.customThemes?.[options.theme] ?? themes[options.theme];
      if (named)
        return { requested: named, customThemes, label: options.theme };

      if (options.theme.endsWith('.json') && fs.existsSync(options.theme)) {
        try {
          const content = fs.readFileSync(
            path.resolve(process.cwd(), options.theme),
            'utf-8'
          );
          return {
            requested: JSON.parse(content),
            customThemes,
            label: options.theme,
          };
        } catch {}
      }

      emitDiagnostic(
        `Unknown theme "${options.theme}"; keeping the document's own theme`,
        'warning'
      );
    }

    if (typeof options.theme === 'object' && options.theme !== null) {
      return {
        requested: options.theme,
        customThemes,
        label: safeThemeKey(options.theme.name),
      };
    }

    return { requested: undefined, customThemes, label: undefined };
  }

  async loadCustomThemes(
    options: GeneratorOptions
  ): Promise<Record<string, any> | undefined> {
    return (await this.resolveThemes(options)).customThemes;
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
