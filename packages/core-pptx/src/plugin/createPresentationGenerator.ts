import type { TSchema } from '@sinclair/typebox';
import type { CustomComponent } from '@json-to-office/shared/plugin';
import {
  resolveComponentVersion,
  DuplicateComponentError,
  ComponentValidationError,
} from '@json-to-office/shared/plugin';
import type {
  PptxComponentInput,
  PresentationComponentDefinition,
  PipelineWarning,
  PptxThemeConfig,
  PendingXmlFill,
} from '../types';
import type {
  ExtendedPresentationComponent,
  PresentationGeneratorBuilder,
  BufferGenerationResult,
  FileGenerationResult,
  GenerateFileOptions,
  GenerateOptions,
  GenerationValidationOptions,
  ValidationResult,
} from './types';
import { validatePresentation, cleanComponentProps } from './validation';
import { generatePluginPresentationSchema, exportPluginSchema } from './schema';
import { processPresentation } from '../core/structure';
import { renderPresentation } from '../core/render';
import { getPptxTheme } from '../themes';
import type { ServicesConfig, FontRuntimeOpts } from '@json-to-office/shared';
import { resolveDocumentFonts } from '../core/fontResolution';
import { applyExportMode, scopedThemeName } from '@json-to-office/shared';
import {
  packagePresentationBuffer,
  type PresentationPackagingOptions,
} from '../core/packagePresentation';

/**
 * Options for creating a presentation generator
 */
export interface PresentationGeneratorOptions
  extends PresentationPackagingOptions {
  /** Theme configuration or theme name */
  theme?: PptxThemeConfig | string;
  /** Custom themes map */
  customThemes?: Record<string, PptxThemeConfig>;
  /** Enable debug logging */
  debug?: boolean;
  /** External service configuration (e.g. Highcharts export server) */
  services?: ServicesConfig;
  /** Font resolution options — extraEntries, Google Fonts config, onResolved hook. */
  fonts?: FontRuntimeOpts;
  /** Default validation behavior; per-call options take precedence. */
  validation?: GenerationValidationOptions;
}

/**
 * Internal state held by each builder instance
 */
interface BuilderState {
  components: readonly CustomComponent<any, any, any>[];
  componentNames: Set<string>;
  theme?: PptxThemeConfig | string;
  customThemes?: Record<string, PptxThemeConfig>;
  debug: boolean;
  services?: ServicesConfig;
  fonts?: FontRuntimeOpts;
  validation?: GenerationValidationOptions;
  packaging: PresentationPackagingOptions;
}

type ValidateEmitted = (
  emitted: PptxComponentInput[],
  componentLabel: string,
  parentName?: string
) => void;

/**
 * Create the builder implementation with the given state
 */
function createBuilderImpl<
  TComponents extends readonly CustomComponent<any, any, any>[],
>(state: BuilderState): PresentationGeneratorBuilder<TComponents> {
  const componentMap = new Map(state.components.map((c) => [c.name, c]));

  /**
   * Process custom components in slide children, recursively resolving them
   * to standard PptxComponentInput elements.
   */
  async function processSlideComponents(
    components: PptxComponentInput[],
    warningsCollector: PipelineWarning[],
    theme: PptxThemeConfig,
    validateEmitted: ValidateEmitted | undefined,
    parentName?: string,
    depth = 0
  ): Promise<PptxComponentInput[]> {
    if (depth > 20) {
      throw new Error(
        'Maximum component nesting depth exceeded (20). Check for circular component references.'
      );
    }
    const processed: PptxComponentInput[] = [];

    for (const componentData of components) {
      const customComponent = componentMap.get(componentData.name);

      if (customComponent) {
        try {
          if (!componentData.props) {
            throw new Error(
              `Custom component '${componentData.name}' must have a 'props' property. ` +
                `Use format: { name: '${componentData.name}', props: {...} }`
            );
          }

          const componentWithVersion = componentData as {
            name: string;
            version?: string;
            props: Record<string, any>;
            children?: PptxComponentInput[];
          };

          // Resolve version
          const versionEntry = resolveComponentVersion(
            customComponent.name,
            customComponent.versions,
            componentWithVersion.version
          );

          // Validate and clean props
          const cleanedProps = cleanComponentProps(
            versionEntry,
            componentWithVersion.props
          );

          // Process nested children if container
          let nestedChildren: unknown[] | undefined;
          if (
            componentWithVersion.children &&
            Array.isArray(componentWithVersion.children)
          ) {
            nestedChildren = await processSlideComponents(
              componentWithVersion.children,
              warningsCollector,
              theme,
              validateEmitted,
              undefined,
              depth + 1
            );
          }

          // Create addWarning callback
          const versionLabel = componentWithVersion.version
            ? `${customComponent.name}@${componentWithVersion.version}`
            : customComponent.name;

          const addWarning = (
            message: string,
            context?: Record<string, unknown>
          ) => {
            warningsCollector.push({
              code: (context?.code as string) ?? 'PLUGIN_WARNING',
              message,
              component: versionLabel,
              slide: context?.slide as number | undefined,
            });
          };

          // Call render
          const result = await versionEntry.render({
            props: cleanedProps,
            theme,
            addWarning,
            children: nestedChildren,
          });

          const resultComponents = (
            Array.isArray(result) ? result : [result]
          ) as PptxComponentInput[];

          validateEmitted?.(resultComponents, versionLabel, parentName);

          // Recursively process in case result contains more custom components
          const processedResult = await processSlideComponents(
            resultComponents,
            warningsCollector,
            theme,
            validateEmitted,
            parentName,
            depth + 1
          );
          processed.push(...processedResult);

          if (state.debug) {
            console.log(
              `Processed custom component '${versionLabel}':`,
              processedResult
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
        // Standard component — process children recursively
        if (componentData.children && Array.isArray(componentData.children)) {
          const processedChildren = await processSlideComponents(
            componentData.children,
            warningsCollector,
            theme,
            validateEmitted,
            componentData.name,
            depth + 1
          );
          processed.push({
            ...componentData,
            children: processedChildren,
          });
        } else {
          processed.push(componentData);
        }
      }
    }

    return processed;
  }

  /**
   * Add a custom component to the generator
   */
  function addComponent<TNewComponent extends CustomComponent<any, any, any>>(
    component: TNewComponent
  ): PresentationGeneratorBuilder<readonly [...TComponents, TNewComponent]> {
    if (!component.name) {
      throw new Error('Component name is required');
    }

    if (state.componentNames.has(component.name)) {
      throw new DuplicateComponentError(component.name);
    }

    const newComponentNames = new Set(state.componentNames);
    newComponentNames.add(component.name);

    const newState: BuilderState = {
      components: [...state.components, component],
      componentNames: newComponentNames,
      theme: state.theme,
      customThemes: state.customThemes,
      debug: state.debug,
      services: state.services,
      fonts: state.fonts,
      validation: state.validation,
      packaging: state.packaging,
    };

    return createBuilderImpl<readonly [...TComponents, TNewComponent]>(
      newState
    );
  }

  /**
   * Generate a presentation buffer
   */
  async function generate(
    document: ExtendedPresentationComponent<TComponents>,
    options?: GenerateOptions
  ): Promise<BufferGenerationResult> {
    try {
      let internalDocument =
        document as unknown as PresentationComponentDefinition;

      const validationOptions: GenerationValidationOptions = {
        ...state.validation,
        ...options?.validation,
      };
      if (validationOptions.enabled !== false) {
        const result = validatePresentation(
          internalDocument,
          state.components as unknown as CustomComponent<TSchema>[],
          { allowUnknownFields: validationOptions.allowUnknownFields }
        );
        if (!result.valid) {
          throw new ComponentValidationError(result.errors, internalDocument);
        }
      } else if (!internalDocument || internalDocument.name !== 'pptx') {
        throw new Error('Top-level component must be a pptx component');
      }

      // An inline theme object (self-contained document) is normalized to a
      // name + resolved theme so font-mode scoping and the name-keyed
      // customThemes re-resolution below work unchanged.
      let inlineTheme: PptxThemeConfig | undefined;
      if (
        typeof internalDocument.props.theme === 'object' &&
        internalDocument.props.theme !== null
      ) {
        inlineTheme = internalDocument.props.theme as PptxThemeConfig;
        internalDocument = {
          ...internalDocument,
          props: {
            ...internalDocument.props,
            theme: inlineTheme.name || 'inline-theme',
          },
        };
      }

      // Resolve theme: doc-level `props.theme` wins (matches non-plugin path
      // and DOCX). A constructor-supplied `state.theme` object only acts as
      // the fallback when the doc names a theme we can't find — otherwise a
      // playground/CLI default theme would silently shadow customThemes
      // entries (e.g. `props.theme: "wiseair"` rendering as `themes.minimal`).
      const docThemeName = internalDocument.props.theme as string | undefined;
      const baseThemeName =
        docThemeName ??
        (typeof state.theme === 'string' ? state.theme : 'default');
      let resolvedTheme =
        inlineTheme ??
        state.customThemes?.[baseThemeName] ??
        (typeof state.theme === 'object' && state.theme !== null
          ? state.theme
          : getPptxTheme(baseThemeName));

      const warnings: PipelineWarning[] = [];

      // Export-mode pre-pass runs BEFORE custom-component expansion so
      // any component that reads `theme.fonts.*` during render sees the
      // substituted names, not the original non-safe ones. Otherwise the
      // rewritten tree would still contain pre-substitute family strings
      // baked in by custom components.
      const mode = applyExportMode({
        doc: internalDocument,
        theme: resolvedTheme,
        fonts: state.fonts,
      });
      resolvedTheme = mode.theme;
      for (const w of mode.warnings) {
        warnings.push({
          code: w.code,
          message: w.message,
          component: 'fontRegistry',
        });
      }

      // A custom render() creates a new, previously unseen boundary in the
      // component tree. Validate its output in the authored parent context so
      // dead props and illegal placement cannot reach the renderer silently.
      const validateEmitted: ValidateEmitted | undefined =
        validationOptions.enabled === false
          ? undefined
          : (emitted, componentLabel, parentName) => {
              let validationDocument: PresentationComponentDefinition;
              if (parentName === 'pptx') {
                validationDocument = { ...mode.doc, children: emitted };
              } else if (parentName === 'slide') {
                validationDocument = {
                  ...mode.doc,
                  children: [{ name: 'slide', props: {}, children: emitted }],
                };
              } else {
                // Custom container semantics are plugin-defined. The complete
                // expanded-tree pass below validates the final standard tree.
                return;
              }

              const result = validatePresentation(
                validationDocument,
                state.components as unknown as CustomComponent<TSchema>[],
                { allowUnknownFields: validationOptions.allowUnknownFields }
              );
              if (!result.valid) {
                throw new ComponentValidationError(
                  result.errors.map((error) => ({
                    ...error,
                    message: `custom component '${componentLabel}' emitted invalid output — ${error.message}`,
                  })),
                  emitted
                );
              }
            };

      // Process custom components in all slide children
      const processedChildren = mode.doc.children
        ? await processAllSlides(
            mode.doc.children,
            warnings,
            resolvedTheme,
            validateEmitted
          )
        : [];

      // Scope the theme key by mode so any future theme-name-keyed cache
      // in PPTX can't leak a custom-mode layout into a substitute-mode run
      // (or vice versa). Matches the DOCX plugin path.
      const themeName = scopedThemeName(baseThemeName, state.fonts?.mode);
      const docWithScopedTheme: PresentationComponentDefinition =
        themeName !== baseThemeName
          ? {
              ...mode.doc,
              props: { ...mode.doc.props, theme: themeName },
              children: processedChildren,
            }
          : { ...mode.doc, children: processedChildren };

      const processedDocument = docWithScopedTheme;

      // Validate the fully expanded tree once more. This covers output from
      // nested custom containers whose intermediate parent semantics are
      // plugin-defined and therefore cannot be checked at render time.
      if (validationOptions.enabled !== false) {
        const result = validatePresentation(processedDocument, [], {
          allowUnknownFields: validationOptions.allowUnknownFields,
        });
        if (!result.valid) {
          throw new ComponentValidationError(
            result.errors.map((error) => ({
              ...error,
              message: `expanded plugin output failed validation — ${error.message}`,
            })),
            processedDocument
          );
        }
      }

      // resolveDocumentFonts fires `fonts.onResolved` internally when a
      // listener is registered (LibreOffice preview stager). The PPTX
      // itself never embeds bytes.
      await resolveDocumentFonts(
        processedDocument,
        resolvedTheme,
        warnings,
        state.fonts
      );

      // processPresentation re-resolves the theme from `props.theme`; inject
      // the post-substitute theme under the scoped name so substitute-mode
      // rewrites survive into slide processing instead of being overwritten
      // by a fresh `getPptxTheme()` lookup.
      const effectiveCustomThemes = {
        ...(state.customThemes ?? {}),
        [themeName]: resolvedTheme,
      };
      const processed = processPresentation(processedDocument, {
        customThemes: effectiveCustomThemes,
        services: state.services,
      });
      const pendingFills: PendingXmlFill[] = [];
      const pptx = await renderPresentation(processed, warnings, pendingFills);
      const data = await pptx.write({ outputType: 'nodebuffer' });
      const buffer = await packagePresentationBuffer(data as Buffer, {
        deterministic: options?.deterministic ?? state.packaging.deterministic,
        generatedAt: options?.generatedAt ?? state.packaging.generatedAt,
        pendingFills,
      });

      return { buffer, warnings };
    } catch (error) {
      if (state.debug) {
        console.error('Presentation generation error:', error);
      }
      throw error;
    }
  }

  /**
   * Process custom components inside all slides.
   * Walks the top-level children (slides), then processes each slide's children.
   */
  async function processAllSlides(
    children: PptxComponentInput[],
    warnings: PipelineWarning[],
    theme: PptxThemeConfig,
    validateEmitted: ValidateEmitted | undefined
  ): Promise<PptxComponentInput[]> {
    const result: PptxComponentInput[] = [];

    for (const child of children) {
      if (child.name === 'slide' && child.children) {
        const processedSlideChildren = await processSlideComponents(
          child.children,
          warnings,
          theme,
          validateEmitted,
          'slide'
        );
        result.push({ ...child, children: processedSlideChildren });
      } else {
        // Non-slide top-level children — process in case they're custom
        const processedTopLevel = await processSlideComponents(
          [child],
          warnings,
          theme,
          validateEmitted,
          'pptx'
        );
        result.push(...processedTopLevel);
      }
    }

    return result;
  }

  /**
   * Generate and save to file
   */
  async function generateFile(
    document: ExtendedPresentationComponent<TComponents>,
    outputPath: string,
    options?: GenerateFileOptions
  ): Promise<FileGenerationResult> {
    const { buffer, warnings } = await generate(document, options);
    const fs = await import('fs/promises');
    await fs.writeFile(outputPath, new Uint8Array(buffer));
    return { warnings };
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
    document: ExtendedPresentationComponent<TComponents>
  ): ValidationResult {
    try {
      const internalDocument =
        document as unknown as PresentationComponentDefinition;
      const result = validatePresentation(
        internalDocument,
        state.components as unknown as CustomComponent<TSchema>[]
      );
      if (!result.valid) {
        return {
          valid: false,
          errors: result.errors.map((e) => ({
            path: e.path,
            message: e.message,
          })),
        };
      }
      return { valid: true };
    } catch (error) {
      if (error instanceof ComponentValidationError) {
        return {
          valid: false,
          errors: error.errors.map((e) => ({
            path: e.path,
            message: e.message,
          })),
        };
      }
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
   * Generate the extended JSON schema
   */
  function generateSchema(): TSchema {
    return generatePluginPresentationSchema(
      state.components as unknown as CustomComponent<TSchema>[]
    );
  }

  /**
   * Export the schema to a file
   */
  async function exportSchemaToFile(
    outputPath: string,
    options?: { prettyPrint?: boolean }
  ): Promise<void> {
    await exportPluginSchema(
      state.components as unknown as CustomComponent<TSchema>[],
      outputPath,
      options
    );
  }

  return Object.freeze({
    addComponent,
    generate,
    generateBuffer: generate,
    generateFile,
    getComponentNames,
    validate,
    generateSchema,
    exportSchema: exportSchemaToFile,
  });
}

/**
 * Create a presentation generator with chainable component registration.
 */
export function createPresentationGenerator(
  options: PresentationGeneratorOptions = {}
): PresentationGeneratorBuilder<readonly []> {
  const initialState: BuilderState = {
    components: [],
    componentNames: new Set(),
    theme: options.theme,
    customThemes: options.customThemes,
    debug: options.debug ?? false,
    services: options.services,
    fonts: options.fonts,
    validation: options.validation,
    packaging: {
      deterministic: options.deterministic,
      generatedAt: options.generatedAt,
    },
  };

  return createBuilderImpl<readonly []>(initialState);
}
