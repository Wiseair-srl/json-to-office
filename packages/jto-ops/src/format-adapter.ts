import * as path from 'path';
import * as fs from 'fs';

import type {
  ServicesConfig,
  FontRuntimeOpts,
  PptxRasterizer,
  PptxBatchRasterizer,
  GenerationWarning,
  RendererStatus,
} from '@json-to-office/shared';
import type {
  PreparedDocument,
  QualityAnalysis,
  QualityPolicy,
  QualityProfile,
} from '@json-to-office/quality';
import { validatePresentationDocument } from '@json-to-office/shared-pptx';
import { validate as validateDocx } from '@json-to-office/shared-docx';
import {
  createLibreOfficePptxRasterizer,
  createLibreOfficePptxBatchRasterizer,
} from './pptx-rasterizer.js';
import { emitDiagnostic } from './diagnostics.js';

/** Forward structured warnings collected during generation to the host's sink. */
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

function preparedThemeLabel(prepared: PreparedDocument): string | undefined {
  const label = prepared.metadata?.themeLabel;
  return typeof label === 'string' ? label : undefined;
}

/**
 * The document a prepared model was built from, and the warnings its
 * preparation already reported.
 *
 * Symbols, so neither crosses a serialization boundary: `PreparedDocument` is
 * a serializable contract, and a model that arrives without its source is
 * re-prepared rather than rendered in place of the document it was handed.
 */
const PREPARED_SOURCE = Symbol('jto.prepared.source');
const PREPARED_WARNINGS = Symbol('jto.prepared.warnings');

interface PreparedInternals {
  [PREPARED_SOURCE]?: unknown;
  [PREPARED_WARNINGS]?: readonly GenerationWarning[];
}

/** Bind a prepared model to the document and the warnings it came from. */
function stampPrepared<T extends PreparedDocument>(
  prepared: T,
  source: unknown,
  warnings: readonly GenerationWarning[]
): T {
  return Object.assign(prepared, {
    [PREPARED_SOURCE]: source,
    [PREPARED_WARNINGS]: warnings,
  });
}

/**
 * A prepared model, but only for the document it was prepared from.
 *
 * `generateBuffer(document)` is a per-document API while `prepared` is fixed
 * when the generator is built, so any other document would be validated as
 * itself and then rendered as the prepared one.
 */
function preparedFor<T extends PreparedDocument>(
  prepared: T | undefined,
  document: unknown
): T | undefined {
  if (!prepared) return undefined;
  const source = (prepared as PreparedInternals)[PREPARED_SOURCE];
  return source !== undefined && source === document ? prepared : undefined;
}

/** Warning identity, for the prepare/render overlap only. */
function warningKey(warning: GenerationWarning): string {
  return `${warning.component}|${warning.context?.code ?? ''}|${warning.message}`;
}

/**
 * Drop render warnings this model's preparation already reported.
 *
 * Preparation repeats work the render does again — pptx block, layout and grid
 * resolution above all — so reusing a prepared model would report those
 * warnings twice. Deliberately narrow: nothing is deduplicated except against
 * what preparing this very model emitted.
 */
function withoutPreparedWarnings(
  warnings: GenerationWarning[],
  prepared: PreparedDocument | undefined
): GenerationWarning[] {
  const emitted = (prepared as PreparedInternals | undefined)?.[
    PREPARED_WARNINGS
  ];
  if (!emitted || emitted.length === 0) return warnings;
  const seen = new Set(emitted.map(warningKey));
  return warnings.filter((warning) => !seen.has(warningKey(warning)));
}

/**
 * The renderer the document itself names. Core generation resolves
 * `options.renderer ?? document.renderer`, so preparation that reads only the
 * option stamps the default onto the model and misjudges a profile targeted
 * at the backend the document actually renders with.
 */
function documentRenderer(document: unknown): string | undefined {
  const renderer = (document as { renderer?: unknown } | null | undefined)
    ?.renderer;
  return typeof renderer === 'string' ? renderer : undefined;
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
  // A public export server receives every chart's data; the switch that
  // permits it is deliberate and separate from naming the URL.
  const allowRemote = /^(1|true|yes)$/i.test(
    process.env.HIGHCHARTS_ALLOW_REMOTE ?? ''
  );

  if (!serverUrl && !apiKey && !allowRemote) return undefined;

  return {
    highcharts: {
      serverUrl,
      ...(apiKey && { headers: { [apiKeyHeader]: apiKey } }),
      ...(allowRemote && { allowRemote }),
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
/**
 * Services a caller asked for win over the environment, service by service:
 * a test that names an unreachable export server must reach it, whatever
 * `HIGHCHARTS_SERVER_URL` says.
 */
function withRequestedServices(
  base: ServicesConfig | undefined,
  requested: ServicesConfig | undefined
): ServicesConfig | undefined {
  if (!requested) return base;
  return {
    ...base,
    ...requested,
    ...(base?.highcharts || requested.highcharts
      ? { highcharts: { ...base?.highcharts, ...requested.highcharts } }
      : {}),
  };
}

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
      /** DOCX only; PPTX generators ignore it. */
      svgRasterFallback?: boolean;
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
  /**
   * External services for this generation: an export server for
   * `highcharts`, a rasterizer for `visual`. Wins over the environment,
   * service by service.
   */
  services?: ServicesConfig;
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
   * Rasterize a PNG fallback for each inline SVG. Defaults to true.
   *
   * DOCX only — pptx embeds SVG without a raster twin. Only readers older than
   * Word 2016 draw it, and producing it dominates the render of a document
   * whose artwork is many small SVGs.
   */
  svgRasterFallback?: boolean;
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
  /** Design profile and invocation-specific enforcement. */
  quality?: {
    profile?: QualityProfile;
    policy?: QualityPolicy;
  };
  /** Opaque canonical prologue output shared by analysis and rendering. */
  prepared?: PreparedDocument;
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

  /**
   * Validate a document that names plugin components.
   *
   * `validateDocument` above knows the standard components and nothing else,
   * so a registered plugin reads to it as `Unknown component "weather"` —
   * the same name the schema route offers for completion and the generator
   * expands. The core validators take the registered components, defer those
   * nodes from the standard walk, and check each one's props against the
   * version it resolves to; this is the seam that reaches them.
   *
   * Async because the core that owns them is imported on demand, as
   * `analyzeQuality` does. Callers with no plugins registered should keep
   * using the sync entry point.
   */
  validateDocumentWithPlugins?(
    doc: unknown,
    plugins: any[]
  ): Promise<{ valid: boolean; errors?: any[] }>;

  /** Analyze format-specific design quality with profiles, policy, and gate. */
  analyzeQuality?(
    doc: unknown,
    options?: GeneratorOptions
  ): Promise<QualityAnalysis>;

  /** Prepare effective values and provenance once for official pipelines. */
  prepareDocument?(
    doc: unknown,
    options?: GeneratorOptions
  ): Promise<PreparedDocument>;

  generateSchema(options?: any): any;

  getBuiltinThemes(): Record<string, any>;
  /** Full values for ESM hosts; falls back to `getBuiltinThemes` for plugins. */
  getBuiltinThemeValues?(): Promise<Record<string, any>>;
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

  /**
   * The same renderers, each with whether its backend loads on this host.
   *
   * `rendererIds` answers "what is registered", which is not the same question:
   * a factory only runs when its renderer is selected, so an id says nothing
   * about whether the render behind it will work. Anything that *advertises*
   * renderers should report this instead — otherwise a caller picks one, gets
   * a green light from validation, and fails a call later.
   */
  rendererStatuses(): Promise<readonly RendererStatus[]>;

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

  async rendererStatuses(): Promise<readonly RendererStatus[]> {
    const core = await import('@json-to-office/core-docx');
    return core.docxRendererStatuses();
  }

  async generateBuffer(
    json: unknown,
    options: GeneratorOptions
  ): Promise<Buffer> {
    const core = await import('@json-to-office/core-docx');
    const parsed = typeof json === 'string' ? JSON.parse(json as string) : json;
    const prepared = preparedFor(
      options.prepared?.format === 'docx'
        ? (options.prepared as ReturnType<
            typeof core.prepareDocxQualityDocument
          >)
        : undefined,
      parsed
    );
    let docDefinition: unknown;
    let customThemes: Record<string, any> | undefined;
    if (prepared) {
      docDefinition = prepared.model.authored;
    } else {
      const resolved = await this.resolveThemes(options);
      const normalized = withRequestedTheme(
        parsed,
        resolved.requested,
        resolved.customThemes
      );
      docDefinition = normalized.document;
      customThemes = normalized.customThemes;
    }
    const services = withRequestedServices(
      buildDocxServices(),
      options.services
    );
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
      svgRasterFallback: options.svgRasterFallback,
      prepared,
      warnings,
    });
    const emitted = withoutPreparedWarnings(warnings, prepared);
    emitGenerationWarnings(emitted);
    options.warnings?.push(...toGenerationWarnings(emitted));
    return buffer;
  }

  async createGenerator(
    plugins: any[],
    options: GeneratorOptions
  ): Promise<GeneratorResult> {
    const core = await import('@json-to-office/core-docx');
    const hasPlugins = plugins.length > 0;
    const pluginNames = plugins.map((p) => p.name);
    const services = withRequestedServices(
      buildDocxServices(),
      options.services
    );

    // Resolve once unless the canonical model already carries the result.
    const prepared =
      !hasPlugins && options.prepared?.format === 'docx'
        ? (options.prepared as ReturnType<
            typeof core.prepareDocxQualityDocument
          >)
        : undefined;
    const resolved = prepared ? undefined : await this.resolveThemes(options);
    const requestedTheme = resolved?.requested;
    const customThemes = resolved?.customThemes;
    const themeLabel = prepared
      ? preparedThemeLabel(prepared)
      : resolved?.label;

    if (!hasPlugins) {
      // A prepared model renders only its own document; any other one falls
      // back to resolving themes here, memoized so a bad `--theme` still
      // warns once per generator.
      let fallbackThemes: Promise<ResolvedThemes> | undefined;
      const themesFor = (): Promise<ResolvedThemes> =>
        (fallbackThemes ??= resolved
          ? Promise.resolve(resolved)
          : this.resolveThemes(options));
      return {
        generateBuffer: async (document: any) => {
          const parsed =
            typeof document === 'string' ? JSON.parse(document) : document;
          const usable = preparedFor(prepared, parsed);
          const themes = usable ? undefined : await themesFor();
          const normalized = usable
            ? { document: usable.model.authored, customThemes: undefined }
            : withRequestedTheme(
                parsed,
                themes?.requested,
                themes?.customThemes
              );
          const warnings: GenerationWarning[] = [];
          const buffer = await core.generateBufferFromJson(
            normalized.document,
            {
              customThemes: normalized.customThemes,
              services,
              fonts: options.fonts,
              validation: {
                allowUnknownFields: options.validation?.allowUnknownFields,
              },
              deterministic: options.deterministic,
              generatedAt: options.generatedAt,
              baseDir: options.baseDir,
              renderer: options.renderer as DocxRendererId | undefined,
              svgRasterFallback: options.svgRasterFallback,
              prepared: usable,
              warnings,
            }
          );
          const emitted = withoutPreparedWarnings(warnings, usable);
          emitGenerationWarnings(emitted);
          options.warnings?.push(...toGenerationWarnings(emitted));
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
      svgRasterFallback: options.svgRasterFallback,
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
          svgRasterFallback: options.svgRasterFallback,
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

  async validateDocumentWithPlugins(
    doc: unknown,
    plugins: any[]
  ): Promise<{ valid: boolean; errors?: any[] }> {
    const core = await import('@json-to-office/core-docx');
    const parsed = typeof doc === 'string' ? JSON.parse(doc) : doc;
    const result = core.validateDocument(parsed as any, plugins);
    const errors = result.errors ?? [];
    return {
      valid: result.valid,
      ...(errors.length > 0 && { errors }),
    };
  }

  async analyzeQuality(
    doc: unknown,
    options: GeneratorOptions = {}
  ): Promise<QualityAnalysis> {
    const core = await import('@json-to-office/core-docx');
    const parsed = typeof doc === 'string' ? JSON.parse(doc) : doc;
    let prepared = preparedFor(
      options.prepared?.format === 'docx'
        ? (options.prepared as ReturnType<
            typeof core.prepareDocxQualityDocument
          >)
        : undefined,
      parsed
    );
    if (!prepared) {
      try {
        prepared = (await this.prepareModel(parsed, options, [])) as ReturnType<
          typeof core.prepareDocxQualityDocument
        >;
      } catch {
        // Structural validation owns malformed trees. The core guards its own
        // preparation, so handing it the document instead of a model turns a
        // throw into an analysis that reports the failure.
      }
    }
    return core.analyzeDocxQuality(prepared?.model.authored ?? parsed, {
      ...(prepared && { prepared }),
      renderer: options.renderer ?? documentRenderer(parsed),
      profile: options.quality?.profile,
      policy: options.quality?.policy,
    });
  }

  async prepareDocument(
    doc: unknown,
    options: GeneratorOptions = {}
  ): Promise<PreparedDocument> {
    // Preparation resolves the theme context the render then skips, so these
    // warnings reach the host from here or not at all.
    const warnings: GenerationWarning[] = [];
    const prepared = await this.prepareModel(doc, options, warnings);
    emitGenerationWarnings(warnings);
    options.warnings?.push(...toGenerationWarnings(warnings));
    return prepared;
  }

  /** Prepare into a caller-owned sink; `prepareDocument` owns the reporting. */
  private async prepareModel(
    doc: unknown,
    options: GeneratorOptions,
    warnings: GenerationWarning[]
  ): Promise<PreparedDocument> {
    const core = await import('@json-to-office/core-docx');
    const parsed = typeof doc === 'string' ? JSON.parse(doc) : doc;
    const resolved = await this.resolveThemes(options);
    const normalized = withRequestedTheme(
      parsed,
      resolved.requested,
      resolved.customThemes
    );
    const prepared = core.prepareDocxQualityDocument(
      normalized.document as any,
      {
        customThemes: normalized.customThemes,
        fonts: options.fonts,
        renderer: options.renderer ?? documentRenderer(parsed),
        warnings,
      }
    );
    return stampPrepared(
      {
        ...prepared,
        metadata: {
          ...prepared.metadata,
          ...(resolved.label && { themeLabel: resolved.label }),
        },
      },
      parsed,
      toGenerationWarnings(warnings)
    );
  }

  generateSchema(_options?: any): any {
    // Delegate to shared-docx
    return null;
  }

  getBuiltinThemes(): Record<string, any> {
    try {
      const core = require('@json-to-office/core-docx');
      return core.themes || {};
    } catch {
      return {};
    }
  }

  async getBuiltinThemeValues(): Promise<Record<string, any>> {
    const core = await import('@json-to-office/core-docx');
    return core.themes || {};
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

  async rendererStatuses(): Promise<readonly RendererStatus[]> {
    const core = await import('@json-to-office/core-pptx');
    return core.pptxRendererStatuses();
  }

  async generateBuffer(
    json: unknown,
    options: GeneratorOptions
  ): Promise<Buffer> {
    const core = await import('@json-to-office/core-pptx');
    const parsed = typeof json === 'string' ? JSON.parse(json as string) : json;
    const prepared = preparedFor(
      options.prepared?.format === 'pptx'
        ? (options.prepared as ReturnType<
            typeof core.preparePptxQualityDocument
          >)
        : undefined,
      parsed
    );
    let docDefinition: unknown;
    let customThemes: Record<string, any> | undefined;
    if (prepared) {
      docDefinition = prepared.model.authored;
    } else {
      const resolved = await this.resolveThemes(options);
      const normalized = withRequestedTheme(
        parsed,
        resolved.requested,
        resolved.customThemes
      );
      docDefinition = normalized.document;
      customThemes = normalized.customThemes;
    }
    const services = withRequestedServices(
      buildServicesFromEnv(),
      options.services
    );
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
      prepared,
    });
    const emitted = withoutPreparedWarnings(
      toGenerationWarnings(result.warnings),
      prepared
    );
    emitGenerationWarnings(emitted);
    options.warnings?.push(...emitted);
    return result.buffer;
  }

  async createGenerator(
    plugins: any[],
    options: GeneratorOptions
  ): Promise<GeneratorResult> {
    const core = await import('@json-to-office/core-pptx');
    const hasPlugins = plugins.length > 0;
    const pluginNames = plugins.map((p) => p.name);
    const services = withRequestedServices(
      buildServicesFromEnv(),
      options.services
    );

    // Resolve once unless the canonical model already carries the result.
    const prepared =
      !hasPlugins && options.prepared?.format === 'pptx'
        ? (options.prepared as ReturnType<
            typeof core.preparePptxQualityDocument
          >)
        : undefined;
    const resolved = prepared ? undefined : await this.resolveThemes(options);
    const requestedTheme = resolved?.requested;
    const customThemes = resolved?.customThemes;
    const themeLabel = prepared
      ? preparedThemeLabel(prepared)
      : resolved?.label;

    if (!hasPlugins) {
      // A prepared model renders only its own document; any other one falls
      // back to resolving themes here, memoized so a bad `--theme` still
      // warns once per generator.
      let fallbackThemes: Promise<ResolvedThemes> | undefined;
      const themesFor = (): Promise<ResolvedThemes> =>
        (fallbackThemes ??= resolved
          ? Promise.resolve(resolved)
          : this.resolveThemes(options));
      return {
        generateBuffer: async (document: any) => {
          const parsed =
            typeof document === 'string' ? JSON.parse(document) : document;
          const usable = preparedFor(prepared, parsed);
          const themes = usable ? undefined : await themesFor();
          const normalized = usable
            ? { document: usable.model.authored, customThemes: undefined }
            : withRequestedTheme(
                parsed,
                themes?.requested,
                themes?.customThemes
              );
          const result = await core.generateBufferWithWarnings(
            normalized.document,
            {
              customThemes: normalized.customThemes,
              services,
              fonts: options.fonts,
              validation: {
                allowUnknownFields: options.validation?.allowUnknownFields,
              },
              deterministic: options.deterministic,
              generatedAt: options.generatedAt,
              baseDir: options.baseDir,
              renderer: options.renderer as PptxRendererId | undefined,
              prepared: usable,
            }
          );
          const warnings = withoutPreparedWarnings(
            toGenerationWarnings(result.warnings),
            usable
          );
          emitGenerationWarnings(warnings);
          options.warnings?.push(...warnings);
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

  async validateDocumentWithPlugins(
    doc: unknown,
    plugins: any[]
  ): Promise<{ valid: boolean; errors?: any[] }> {
    const core = await import('@json-to-office/core-pptx');
    const parsed = typeof doc === 'string' ? JSON.parse(doc) : doc;
    const result = core.validatePresentation(parsed as any, plugins);
    return {
      valid: result.valid,
      ...(result.errors.length > 0 && { errors: result.errors }),
    };
  }

  async analyzeQuality(
    doc: unknown,
    options: GeneratorOptions = {}
  ): Promise<QualityAnalysis> {
    const core = await import('@json-to-office/core-pptx');
    const parsed = typeof doc === 'string' ? JSON.parse(doc) : doc;
    let prepared = preparedFor(
      options.prepared?.format === 'pptx'
        ? (options.prepared as ReturnType<
            typeof core.preparePptxQualityDocument
          >)
        : undefined,
      parsed
    );
    if (!prepared) {
      try {
        prepared = (await this.prepareModel(parsed, options, [])) as ReturnType<
          typeof core.preparePptxQualityDocument
        >;
      } catch {
        // Structural validation owns malformed trees. The core guards its own
        // preparation, so handing it the document instead of a model turns a
        // throw into an analysis that reports the failure.
      }
    }
    return core.analyzePptxQuality(prepared?.model.authored ?? parsed, {
      ...(prepared && { prepared }),
      renderer: options.renderer ?? documentRenderer(parsed),
      profile: options.quality?.profile,
      policy: options.quality?.policy,
    });
  }

  async prepareDocument(
    doc: unknown,
    options: GeneratorOptions = {}
  ): Promise<PreparedDocument> {
    // Preparation resolves the theme context the render then skips, so these
    // warnings reach the host from here or not at all.
    const warnings: any[] = [];
    const prepared = await this.prepareModel(doc, options, warnings);
    const normalized = toGenerationWarnings(warnings);
    emitGenerationWarnings(normalized);
    options.warnings?.push(...normalized);
    return prepared;
  }

  /** Prepare into a caller-owned sink; `prepareDocument` owns the reporting. */
  private async prepareModel(
    doc: unknown,
    options: GeneratorOptions,
    warnings: any[]
  ): Promise<PreparedDocument> {
    const core = await import('@json-to-office/core-pptx');
    const parsed = typeof doc === 'string' ? JSON.parse(doc) : doc;
    const resolved = await this.resolveThemes(options);
    const normalized = withRequestedTheme(
      parsed,
      resolved.requested,
      resolved.customThemes
    );
    const prepared = core.preparePptxQualityDocument(
      normalized.document as any,
      {
        customThemes: normalized.customThemes,
        fonts: options.fonts,
        services: withRequestedServices(
          buildServicesFromEnv(),
          options.services
        ),
        renderer: options.renderer ?? documentRenderer(parsed),
        warnings,
      }
    );
    return stampPrepared(
      {
        ...prepared,
        metadata: {
          ...prepared.metadata,
          ...(resolved.label && { themeLabel: resolved.label }),
        },
      },
      parsed,
      toGenerationWarnings(warnings)
    );
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

  async getBuiltinThemeValues(): Promise<Record<string, any>> {
    const core = await import('@json-to-office/core-pptx');
    return core.pptxThemes || {};
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
          // Validated, not merely parsed. The DOCX branch has always gone
          // through `loadThemeFromFile`; this one used to hand whatever JSON
          // it found straight to the compiler, which reads
          // `theme.defaults.fontSize` unguarded — so a theme with the wrong
          // shape surfaced as a TypeError in the IR rather than as a
          // diagnostic naming the bad field.
          const shared = await import('@json-to-office/shared-pptx');
          const checked = shared.validatePptxTheme(JSON.parse(content));
          if (!checked.valid) {
            const detail = checked.errors
              .slice(0, 3)
              .map((error: { path?: string; message: string }) =>
                error.path ? `${error.path}: ${error.message}` : error.message
              )
              .join('; ');
            throw new Error(
              `not a valid pptx theme — ${detail}${
                checked.errors.length > 3
                  ? ` (and ${checked.errors.length - 3} more)`
                  : ''
              }`
            );
          }
          fileTheme = checked.data;
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
