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
import { getPptxTheme, hasPptxTheme } from '../themes';
import type { ServicesConfig, FontRuntimeOpts } from '@json-to-office/shared';
import { resolveDocumentFonts } from '../core/fontResolution';
import { resolveThemeContext } from '../core/generationContext';
import { runWithBaseDir } from '../utils/baseDirContext';
import { assertNoContentConflicts } from '../core/generator';
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
  /**
   * Directory that relative asset paths (image `path` props, slide
   * background images) resolve against. Per-call `options.baseDir`
   * overrides it; defaults to `process.cwd()` when neither is set (#142).
   */
  baseDir?: string;
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
  baseDir?: string;
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
      baseDir: state.baseDir,
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

      const warnings: PipelineWarning[] = [];

      // Props defaulting, inline-theme normalization, theme resolution
      // (customThemes → constructor theme → built-in), export-mode pre-pass
      // and cache-key scoping — shared with the core pipeline so the two
      // cannot drift (see core/generationContext.ts). The pre-pass runs
      // BEFORE custom-component expansion so any component that reads
      // `theme.fonts.*` during render sees the substituted names, not the
      // original non-safe ones.
      //
      // Theme precedence: customThemes[name] → doc-named built-in →
      // constructor `state.theme` object → built-in, with the lookup name
      // taken from doc-level `props.theme` (or `defaultThemeName` when the
      // doc names none). A document explicitly naming a known built-in gets
      // it; the constructor object fills in when the doc names nothing or
      // names something nothing recognizes (#141). The `authored` guard on
      // the built-in step matters twice over: an unauthored default name
      // must not shadow the constructor object, and an authored UNKNOWN name
      // must still reach the constructor object (getPptxTheme never misses —
      // a doc naming "wiseair" must render the app's theme, not silently
      // fall back to default). Matches the DOCX plugin
      // (resolveDocumentTheme) exactly.
      const context = resolveThemeContext(internalDocument, {
        customThemes: state.customThemes,
        fonts: state.fonts,
        warnings,
        defaultThemeName:
          typeof state.theme === 'string' ? state.theme : undefined,
        resolveNamedTheme: (name, authored) =>
          state.customThemes?.[name] ??
          (authored && hasPptxTheme(name) ? getPptxTheme(name) : undefined) ??
          (typeof state.theme === 'object' && state.theme !== null
            ? state.theme
            : getPptxTheme(name)),
      });
      const modedRoot = context.document;
      const resolvedTheme = context.theme;

      // A custom render() creates a new, previously unseen boundary in the
      // component tree. Validate its output in the authored parent context so
      // dead props and illegal placement cannot reach the renderer silently.
      const validateEmitted: ValidateEmitted | undefined =
        validationOptions.enabled === false
          ? undefined
          : (emitted, componentLabel, parentName) => {
              let validationDocument: PresentationComponentDefinition;
              if (parentName === 'pptx') {
                validationDocument = { ...modedRoot, children: emitted };
              } else if (parentName === 'slide') {
                validationDocument = {
                  ...modedRoot,
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
      const processedChildren = modedRoot.children
        ? await processAllSlides(
            modedRoot.children,
            warnings,
            resolvedTheme,
            validateEmitted
          )
        : [];

      const processedDocument: PresentationComponentDefinition = {
        ...modedRoot,
        children: processedChildren,
      };

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

      // Unconditional conflict gate on the expanded tree — the tree that
      // reaches the renderer, so it also covers payloads emitted by custom
      // components. The validators above collect the same conflicts with
      // richer paths when validation is enabled; this is the net for
      // `validation: { enabled: false }`, where the core path already threw
      // and this path silently resolved by runtime precedence.
      assertNoContentConflicts(processedDocument);

      // processPresentation takes the resolved (post-substitute) theme by
      // value — the document's `props.theme` stays as authored and is not
      // consulted again.
      // Scope the document base directory over process+render: relative
      // asset paths are rewritten eagerly there — pptxgenjs reads them
      // later, during write() (#142). Matches the core pipeline.
      const { pendingFills, pptx } = await runWithBaseDir(
        options?.baseDir ?? state.baseDir,
        async () => {
          const processed = processPresentation(processedDocument, {
            theme: resolvedTheme,
            services: state.services,
          });
          const pendingFills: PendingXmlFill[] = [];
          const pptx = await renderPresentation(
            processed,
            warnings,
            pendingFills
          );
          return { pendingFills, pptx };
        }
      );
      const data = await pptx.write({ outputType: 'nodebuffer' });
      const buffer = await packagePresentationBuffer(data as Buffer, {
        deterministic: options?.deterministic ?? state.packaging.deterministic,
        generatedAt: options?.generatedAt ?? state.packaging.generatedAt,
        pendingFills,
        warnings,
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
    baseDir: options.baseDir,
  };

  return createBuilderImpl<readonly []>(initialState);
}
