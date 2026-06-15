import { Packer } from 'docx';
import type { TSchema } from '@sinclair/typebox';
import type { CustomComponent } from './createComponent';
import type { ComponentDefinition, ReportComponentDefinition } from '../types';
import { type ThemeConfig, getThemeWithFallback } from '../styles';
import type { GenerationWarning } from '@json-to-office/shared-docx';
import type { ServicesConfig, FontRuntimeOpts } from '@json-to-office/shared';
import { applyExportMode, scopedThemeName } from '@json-to-office/shared';
import { resolveDocumentFonts } from '../core/fontResolution';
import type {
  ExtendedReportComponent,
  DocumentGeneratorBuilder,
  GenerateOptions,
  GenerateFileOptions,
  GenerationResult,
  BufferGenerationResult,
  FileGenerationResult,
  ValidationResult,
  GenerationValidationOptions,
} from './types';
import {
  validateDocument,
  cleanComponentProps,
  ComponentValidationError,
  DuplicateComponentError,
} from './validation';
import { UnknownPreservedComponentError } from '@json-to-office/shared/plugin';
import { resolveComponentVersion } from './version-resolver';
import { generatePluginDocumentSchema, exportPluginSchema } from './schema';
import { processDocument } from '../core/structure';
import { applyLayout } from '../core/layout';
import { renderDocument } from '../core/render';
import { normalizeDocument } from '../json/normalizer';

/**
 * Options for creating a document generator
 */
export interface DocumentGeneratorOptions {
  /** Default theme used when no custom or built-in theme matches */
  theme?: ThemeConfig;
  /** Custom themes keyed by name, resolved per-document via document.props.theme */
  customThemes?: Record<string, ThemeConfig>;
  /** Enable caching for better performance */
  enableCache?: boolean;
  /** Enable debug logging */
  debug?: boolean;
  /** External service configuration (e.g. Highcharts export server) */
  services?: ServicesConfig;
  /** Font resolution options — extraEntries, Google Fonts config, onResolved hook. */
  fonts?: FontRuntimeOpts;
  /**
   * Default validation behavior for every generate/generateBuffer/generateFile
   * call. Per-call `options.validation` overrides these. Validation is on by
   * default; pass `{ enabled: false }` to opt out.
   */
  validation?: GenerationValidationOptions;
}

/**
 * Internal state held by each builder instance
 */
interface BuilderState {
  components: readonly CustomComponent<any, any, any>[];
  componentNames: Set<string>;
  theme?: ThemeConfig;
  customThemes?: Record<string, ThemeConfig>;
  debug: boolean;
  enableCache: boolean;
  services?: ServicesConfig;
  fonts?: FontRuntimeOpts;
  validation?: GenerationValidationOptions;
}

/**
 * Create the builder implementation with the given state
 */
function createBuilderImpl<
  TComponents extends readonly CustomComponent<any, any, any>[],
>(state: BuilderState): DocumentGeneratorBuilder<TComponents> {
  // Create component map for quick lookup
  const componentMap = new Map(state.components.map((c) => [c.name, c]));

  /**
   * Resolve theme for a document: customThemes → built-in → constructor fallback
   */
  function resolveDocumentTheme(themeName: string): ThemeConfig {
    if (state.customThemes) {
      if (state.customThemes[themeName]) {
        return state.customThemes[themeName];
      }
      const key = Object.keys(state.customThemes).find(
        (k) => k.toLowerCase() === themeName.toLowerCase()
      );
      if (key) {
        return state.customThemes[key];
      }
    }
    if (state.theme) {
      return state.theme;
    }
    return getThemeWithFallback(themeName);
  }

  /**
   * Process custom components in the document.
   *
   * Returns two parallel trees built in a single pass:
   * - `standard`: fully expanded — every custom component resolved to standard primitives.
   * - `preserved`: partially expanded — nodes whose name is in `preserveSet` are kept
   *   verbatim (children NOT recursed); everything else is expanded the same as `standard`.
   *
   * `render()` always runs, even for preserved components, because the docx pipeline
   * builds from `standard` and we still need their warnings/font registrations.
   */
  async function processDocumentComponents(
    components: ComponentDefinition[],
    preserveSet: ReadonlySet<string> | undefined,
    warningsCollector: GenerationWarning[],
    resolvedTheme: ThemeConfig,
    validateEmitted:
      | ((emitted: ComponentDefinition[], componentLabel: string) => void)
      | undefined,
    depth = 0
  ): Promise<{
    standard: ComponentDefinition[];
    preserved: ComponentDefinition[];
  }> {
    if (depth > 20) {
      throw new Error(
        'Maximum component nesting depth exceeded (20). Check for circular component references.'
      );
    }
    const standardOut: ComponentDefinition[] = [];
    const preservedOut: ComponentDefinition[] = [];

    for (const componentData of components) {
      // Safe type narrowing for custom component detection
      const componentName = (componentData as { name?: string })?.name;

      if (!componentName) {
        standardOut.push(componentData);
        preservedOut.push(componentData);
        continue;
      }

      const customComponent = componentMap.get(componentName);

      if (customComponent) {
        // This is a custom component - validate and process it
        try {
          const componentWithName = componentData as {
            name: string;
            version?: string;
            props?: unknown;
            children?: unknown;
          };

          if (!componentWithName.props) {
            throw new Error(
              `Custom component '${componentName}' must have a 'props' property. Use format: { name: '${componentName}', props: {...} }`
            );
          }

          // Resolve the correct version entry
          const versionEntry = resolveComponentVersion(
            customComponent.name,
            customComponent.versions,
            componentWithName.version
          );

          // Validate and clean the props against the resolved version's schema
          const cleanedProps = cleanComponentProps(
            versionEntry,
            componentWithName.props
          );

          // Process nested children if this is a container.
          // For the standard tree we need the fully-expanded children to feed render().
          let nestedChildren: unknown[] | undefined;
          if (
            componentWithName.children &&
            Array.isArray(componentWithName.children)
          ) {
            const nested = await processDocumentComponents(
              componentWithName.children as ComponentDefinition[],
              preserveSet,
              warningsCollector,
              resolvedTheme,
              validateEmitted,
              depth + 1
            );
            nestedChildren = nested.standard;
          }

          // Create addWarning callback for this component
          const versionLabel = componentWithName.version
            ? `${customComponent.name}@${componentWithName.version}`
            : customComponent.name;

          const addWarning = (
            message: string,
            context?: Record<string, unknown>
          ) => {
            warningsCollector.push({
              component: versionLabel,
              message,
              severity: 'warning',
              context,
            });
          };

          // Call the render function with context object
          const result = await versionEntry.render({
            props: cleanedProps,
            theme: resolvedTheme,
            addWarning,
            children: nestedChildren,
          });

          // Ensure result is an array
          const resultComponents = (
            Array.isArray(result) ? result : [result]
          ) as ComponentDefinition[];

          // Validate the standard tree this render() emitted, applying the same
          // schema gate authored standard components pass through up front. The
          // pre-expansion pass never saw these nodes, so without this an invalid
          // prop produced by a plugin would ride through into standardDefinition
          // and only surface when that output is validated separately.
          if (validateEmitted) {
            validateEmitted(resultComponents, versionLabel);
          }

          // Recursively process the result in case it contains more custom components
          const processedResult = await processDocumentComponents(
            resultComponents,
            preserveSet,
            warningsCollector,
            resolvedTheme,
            validateEmitted,
            depth + 1
          );
          standardOut.push(...processedResult.standard);

          if (preserveSet && preserveSet.has(componentName)) {
            // Keep this custom node verbatim in the preserved tree.
            // Per spec: do NOT recurse into authored children — leave the
            // entire subtree as the user wrote it.
            preservedOut.push(componentData);
          } else {
            // Non-preserved custom: emit the recursed expansion (which itself
            // honors preserveSet for any nested customs).
            preservedOut.push(...processedResult.preserved);
          }

          if (state.debug) {
            console.log(
              `Processed custom component '${versionLabel}':`,
              processedResult.standard
            );
          }
        } catch (error) {
          if (error instanceof ComponentValidationError) {
            throw error;
          }
          throw new Error(
            `Error processing custom component '${customComponent.name}': ${
              error instanceof Error ? error.message : String(error)
            }`
          );
        }
      } else {
        // This is a standard component or nested container - process recursively
        if (
          'children' in componentData &&
          Array.isArray(componentData.children)
        ) {
          const processedNested = await processDocumentComponents(
            componentData.children,
            preserveSet,
            warningsCollector,
            resolvedTheme,
            validateEmitted,
            depth + 1
          );
          standardOut.push({
            ...componentData,
            children: processedNested.standard,
          });
          preservedOut.push({
            ...componentData,
            children: processedNested.preserved,
          });
        } else {
          standardOut.push(componentData);
          preservedOut.push(componentData);
        }
      }
    }

    return { standard: standardOut, preserved: preservedOut };
  }

  /**
   * Add a custom component to the generator
   */
  function addComponent<TNewComponent extends CustomComponent<any, any, any>>(
    component: TNewComponent
  ): DocumentGeneratorBuilder<readonly [...TComponents, TNewComponent]> {
    if (!component.name) {
      throw new Error('Component name is required');
    }

    if (state.componentNames.has(component.name)) {
      throw new DuplicateComponentError(component.name);
    }

    // Create NEW immutable state
    const newComponentNames = new Set(state.componentNames);
    newComponentNames.add(component.name);

    const newState: BuilderState = {
      components: [...state.components, component],
      componentNames: newComponentNames,
      theme: state.theme,
      customThemes: state.customThemes,
      debug: state.debug,
      enableCache: state.enableCache,
      services: state.services,
      fonts: state.fonts,
    };

    // Return NEW builder with expanded type
    return createBuilderImpl<readonly [...TComponents, TNewComponent]>(
      newState
    );
  }

  /**
   * Resolve and validate the preserve set for a per-call options object.
   * Returns `undefined` when the caller did not opt in.
   * Throws `UnknownPreservedComponentError` when any listed name is not registered.
   */
  function resolvePreserveSet(
    options?: GenerateOptions
  ): ReadonlySet<string> | undefined {
    const list = options?.preserveCustomComponents;
    if (!list || list.length === 0) {
      return undefined;
    }
    const registered = new Set(state.componentNames);
    const unknown = list.filter((n) => !registered.has(n));
    if (unknown.length > 0) {
      throw new UnknownPreservedComponentError(
        unknown,
        Array.from(state.componentNames)
      );
    }
    return new Set(list);
  }

  /**
   * Generate a document
   */
  async function generate(
    document: ExtendedReportComponent<TComponents>,
    options?: GenerateOptions
  ): Promise<GenerationResult<TComponents>> {
    try {
      const preserveSet = resolvePreserveSet(options);

      // Cast to ReportComponentDefinition for internal processing
      const internalDocument = document as unknown as ReportComponentDefinition;

      // Validate the document first (plugin-aware), unless disabled. Throwing
      // here stops a malformed document from silently building into a corrupt
      // or incomplete DOCX.
      const vOpts: GenerationValidationOptions = {
        ...state.validation,
        ...options?.validation,
      };
      if (vOpts.enabled !== false) {
        const result = validateDocument(
          internalDocument,
          state.components as unknown as CustomComponent<TSchema>[],
          { allowUnknownFields: vOpts.allowUnknownFields }
        );
        if (!result.valid) {
          throw new ComponentValidationError(
            (result.errors ?? []).map((e) => ({
              path: e.path ?? '',
              message: e.message,
            })),
            internalDocument
          );
        }
      }

      // Re-apply the same gate to the tree each custom component's render()
      // emits. The pre-expansion pass above only saw authored nodes, so a
      // standard component produced by a plugin would otherwise reach
      // standardDefinition unchecked. We validate the emitted nodes in their
      // pre-normalization form — exactly how authored nodes are validated —
      // by reusing the already-validated document props as a wrapper, so the
      // only new errors come from the emitted children. Undefined when
      // validation is disabled, which short-circuits the boundary check.
      const validateEmitted =
        vOpts.enabled === false
          ? undefined
          : (emitted: ComponentDefinition[], componentLabel: string) => {
              const result = validateDocument(
                { ...internalDocument, children: emitted },
                state.components as unknown as CustomComponent<TSchema>[],
                { allowUnknownFields: vOpts.allowUnknownFields }
              );
              if (!result.valid) {
                throw new ComponentValidationError(
                  (result.errors ?? []).map((e) => ({
                    path: e.path ?? '',
                    message: `custom component '${componentLabel}' emitted invalid output — ${e.message}`,
                  })),
                  emitted
                );
              }
            };

      // Resolve theme per-document: customThemes → built-in → constructor fallback
      const baseThemeName = internalDocument.props.theme || 'minimal';
      const docTheme = resolveDocumentTheme(baseThemeName);

      // Initialize warnings collector
      const warnings: GenerationWarning[] = [];

      // Export-mode pre-pass runs BEFORE custom-component expansion so
      // components that read `theme.fonts.*` during render see the
      // substituted names, not the original non-safe ones.
      const mode = applyExportMode({
        doc: internalDocument,
        theme: docTheme,
        fonts: state.fonts,
      });
      const modedTheme = mode.theme;
      // Scope cache key by mode: substitute rewrites the theme in place, so
      // structure/layout caches must not share slots with custom-mode runs
      // keyed on the same themeName. Matches core/generator.ts.
      const themeName = scopedThemeName(baseThemeName, state.fonts?.mode);
      for (const w of mode.warnings) {
        warnings.push({
          component: 'fontRegistry',
          message: w.message,
          severity: 'warning',
          context: { code: w.code },
        });
      }

      // Process custom components to convert them to standard components.
      // Builds standard (fully expanded) and preserved (partial) trees in one pass.
      const processed = await processDocumentComponents(
        mode.doc.children || [],
        preserveSet,
        warnings,
        modedTheme,
        validateEmitted
      );

      // Create a new document definition with processed components
      const processedDocument: ReportComponentDefinition = {
        ...mode.doc,
        children: processed.standard,
      };

      // Normalize components (handle shorthand notations and nested structures)
      // We bypass JSON validation since we've already validated with custom schemas
      const [modedDoc] = normalizeDocument(processedDocument);

      // Resolve fonts (reads document + resolved theme). The helper fires
      // `fonts.onResolved` internally when a listener is registered
      // (LibreOffice preview stager). DOCX output itself never embeds
      // bytes; recipients rely on system-installed fonts.
      await resolveDocumentFonts(modedDoc, modedTheme, state.fonts, warnings);

      // Use the document generation pipeline directly
      const structure = await processDocument(modedDoc, modedTheme, themeName);
      const layout = applyLayout(structure.sections, modedTheme, themeName);
      const generatedDocument = await renderDocument(structure, layout, {
        services: state.services,
      });

      // Build preservedDefinition iff the caller opted in. Reuses the same
      // doc shell as standardDefinition but with partially-expanded children.
      // Not normalized — preserved subtrees are meant to be "as authored".
      const preservedDefinition = preserveSet
        ? ({
            ...mode.doc,
            children: processed.preserved,
          } as unknown as ExtendedReportComponent<TComponents>)
        : undefined;

      return {
        document: generatedDocument,
        warnings: warnings.length > 0 ? warnings : null,
        standardDefinition: modedDoc,
        preservedDefinition,
      };
    } catch (error) {
      if (state.debug) {
        console.error('Document generation error:', error);
      }
      throw error;
    }
  }

  /**
   * Generate a document and return as buffer
   */
  async function generateBuffer(
    document: ExtendedReportComponent<TComponents>,
    options?: GenerateOptions
  ): Promise<BufferGenerationResult<TComponents>> {
    const {
      document: doc,
      warnings,
      standardDefinition,
      preservedDefinition,
    } = await generate(document, options);
    const buffer = (await Packer.toBuffer(doc)) as Buffer;
    return { buffer, warnings, standardDefinition, preservedDefinition };
  }

  /**
   * Generate a document and save to file
   */
  async function generateFile(
    document: ExtendedReportComponent<TComponents>,
    outputPath: string,
    options?: GenerateFileOptions
  ): Promise<FileGenerationResult<TComponents>> {
    const { buffer, warnings, standardDefinition, preservedDefinition } =
      await generateBuffer(document, options);
    const fs = await import('fs/promises');
    await fs.writeFile(outputPath, new Uint8Array(buffer));

    let preservedOutputPath: string | undefined;
    if (preservedDefinition !== undefined) {
      const path = await import('path');
      preservedOutputPath =
        options?.preservedOutputPath ??
        (() => {
          const ext = path.extname(outputPath);
          const base = ext ? outputPath.slice(0, -ext.length) : outputPath;
          return `${base}-preserved.json`;
        })();
      await fs.writeFile(
        preservedOutputPath,
        JSON.stringify(preservedDefinition, null, 2),
        'utf8'
      );
    }

    return {
      warnings,
      standardDefinition,
      preservedDefinition,
      preservedOutputPath,
    };
  }

  /**
   * Get registered component names
   */
  function getComponentNames(): string[] {
    return Array.from(state.componentNames);
  }

  /**
   * Validate a document without generating it
   */
  function validate(
    document: ExtendedReportComponent<TComponents>
  ): ValidationResult {
    try {
      // Cast to ReportComponentDefinition for internal validation
      const internalDocument = document as unknown as ReportComponentDefinition;
      const result = validateDocument(
        internalDocument,
        state.components as unknown as CustomComponent<TSchema>[]
      );
      if (result.valid) {
        return { valid: true };
      }
      return {
        valid: false,
        errors: (result.errors ?? []).map((e) => ({
          path: e.path ?? '',
          message: e.message,
        })),
      };
    } catch (error) {
      return {
        valid: false,
        errors: [
          {
            path: 'document',
            message: error instanceof Error ? error.message : String(error),
          },
        ],
      };
    }
  }

  /**
   * @deprecated Read `standardDefinition` off `generate(...)` instead. This wrapper
   * runs the full generation pipeline (including `render()` for every custom)
   * just to surface the JSON tree, so calling it alongside `generate*` doubles
   * the work. Kept for backwards compatibility; will be removed in a future major.
   */
  async function getStandardComponentsDefinition(
    document: ExtendedReportComponent<TComponents>
  ): Promise<ReportComponentDefinition> {
    const { standardDefinition } = await generate(document);
    return standardDefinition;
  }

  /**
   * Generate the extended JSON schema for document validation
   */
  function generateSchema(includeStandardComponents = true): TSchema {
    return generatePluginDocumentSchema(
      state.components as unknown as CustomComponent<TSchema>[],
      includeStandardComponents
    );
  }

  /**
   * Export the extended JSON schema to a file
   */
  async function exportSchemaToFile(
    outputPath: string,
    options?: {
      includeStandardComponents?: boolean;
      prettyPrint?: boolean;
    }
  ): Promise<void> {
    await exportPluginSchema(
      state.components as unknown as CustomComponent<TSchema>[],
      outputPath,
      options
    );
  }

  // Return frozen builder object
  return Object.freeze({
    addComponent,
    generate,
    generateBuffer,
    generateFile,
    getComponentNames,
    validate,
    generateSchema,
    exportSchema: exportSchemaToFile,
    getStandardComponentsDefinition,
  });
}

/**
 * Create a document generator with chainable component registration.
 */
export function createDocumentGenerator(
  options: DocumentGeneratorOptions
): DocumentGeneratorBuilder<readonly []> {
  const initialState: BuilderState = {
    components: [],
    componentNames: new Set(),
    theme: options.theme,
    customThemes: options.customThemes,
    debug: options.debug ?? false,
    enableCache: options.enableCache ?? false,
    services: options.services,
    fonts: options.fonts,
    validation: options.validation,
  };

  return createBuilderImpl<readonly []>(initialState);
}
