import JSZip from 'jszip';
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
} from '../types';
import type {
  ExtendedPresentationComponent,
  PresentationGeneratorBuilder,
  BufferGenerationResult,
  FileGenerationResult,
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

/**
 * Options for creating a presentation generator
 */
export interface PresentationGeneratorOptions {
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
}

/**
 * Replace the default table style (Medium Style 2 - Accent 1, which applies allCaps
 * to headers) with "No Style, No Grid" so table text renders as authored.
 */
const MEDIUM_STYLE_2_ACCENT_1 = '{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}';
const NO_STYLE_NO_GRID = '{2D5ABB26-0587-4C30-8999-92F81FD0307C}';

async function neutralizeTableStyle(buffer: Buffer): Promise<Buffer> {
  const zip = await JSZip.loadAsync(buffer);
  let changed = false;
  for (const [path, entry] of Object.entries(zip.files)) {
    if (!path.match(/^ppt\/slides\/slide\d+\.xml$/)) continue;
    const xml = await entry.async('string');
    if (xml.includes(MEDIUM_STYLE_2_ACCENT_1)) {
      zip.file(path, xml.replaceAll(MEDIUM_STYLE_2_ACCENT_1, NO_STYLE_NO_GRID));
      changed = true;
    }
  }
  return changed
    ? ((await zip.generateAsync({ type: 'nodebuffer' })) as Buffer)
    : buffer;
}

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

          // Recursively process in case result contains more custom components
          const processedResult = await processSlideComponents(
            resultComponents,
            warningsCollector,
            theme,
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
    };

    return createBuilderImpl<readonly [...TComponents, TNewComponent]>(
      newState
    );
  }

  /**
   * Generate a presentation buffer
   */
  async function generate(
    document: ExtendedPresentationComponent<TComponents>
  ): Promise<BufferGenerationResult> {
    try {
      const internalDocument =
        document as unknown as PresentationComponentDefinition;

      if (!internalDocument || internalDocument.name !== 'pptx') {
        throw new Error('Top-level component must be a pptx component');
      }

      // Resolve theme for render context
      const baseThemeName =
        typeof state.theme === 'string'
          ? state.theme
          : internalDocument.props.theme ?? 'default';
      let resolvedTheme =
        typeof state.theme === 'object'
          ? state.theme
          : state.customThemes?.[baseThemeName] ?? getPptxTheme(baseThemeName);

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

      // Process custom components in all slide children
      const processedChildren = mode.doc.children
        ? await processAllSlides(mode.doc.children, warnings, resolvedTheme)
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
      const pptx = await renderPresentation(processed, warnings);
      const data = await pptx.write({ outputType: 'nodebuffer' });
      const buffer = await neutralizeTableStyle(data as Buffer);

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
    theme: PptxThemeConfig
  ): Promise<PptxComponentInput[]> {
    const result: PptxComponentInput[] = [];

    for (const child of children) {
      if (child.name === 'slide' && child.children) {
        const processedSlideChildren = await processSlideComponents(
          child.children,
          warnings,
          theme
        );
        result.push({ ...child, children: processedSlideChildren });
      } else {
        // Non-slide top-level children — process in case they're custom
        const processedTopLevel = await processSlideComponents(
          [child],
          warnings,
          theme
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
    outputPath: string
  ): Promise<FileGenerationResult> {
    const { buffer, warnings } = await generate(document);
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
  };

  return createBuilderImpl<readonly []>(initialState);
}
