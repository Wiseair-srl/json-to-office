import { Packer } from 'docx';
import type { TSchema } from '@sinclair/typebox';
import type { CustomComponent } from './createComponent';
import type { ComponentDefinition, ReportComponentDefinition } from '../types';
import type { ThemeConfig } from '../styles';
import type { GenerationWarning } from '@json-to-office/shared-docx';
import type {
  ExtendedReportComponent,
  DocumentGeneratorBuilder,
  GenerationResult,
  BufferGenerationResult,
  FileGenerationResult,
  ValidationResult,
} from './types';
import {
  validateDocument,
  cleanComponentProps,
  ComponentValidationError,
  DuplicateComponentError,
} from './validation';
import { resolveComponentVersion } from './version-resolver';
import { generatePluginDocumentSchema, exportPluginSchema } from './schema';
import { processDocument } from '../core/structure';
import { applyLayout } from '../core/layout';
import { renderDocument } from '../core/render';
import { normalizeDocument } from '../json/normalizer';
import { resolveTheme } from '../styles/theme-resolver';
import { validateTheme } from '../styles/theme-validator';

/**
 * Options for creating a document generator
 */
export interface DocumentGeneratorOptions {
  /** Theme configuration */
  theme: ThemeConfig;
  /** Enable caching for better performance */
  enableCache?: boolean;
  /** Enable debug logging */
  debug?: boolean;
}

/**
 * Internal state held by each builder instance
 */
interface BuilderState {
  components: readonly CustomComponent<any, any, any>[];
  componentNames: Set<string>;
  theme: ThemeConfig;
  debug: boolean;
  enableCache: boolean;
}

/**
 * Create the builder implementation with the given state
 */
function createBuilderImpl<
  TComponents extends readonly CustomComponent<any, any, any>[],
>(state: BuilderState): DocumentGeneratorBuilder<TComponents> {
  // Validate and resolve theme
  const validatedTheme = validateTheme(state.theme);
  const fullTheme = resolveTheme(validatedTheme);

  // Create component map for quick lookup
  const componentMap = new Map(state.components.map((c) => [c.name, c]));

  /**
   * Process custom components in the document
   */
  async function processDocumentComponents(
    components: ComponentDefinition[],
    warningsCollector: GenerationWarning[]
  ): Promise<ComponentDefinition[]> {
    const processedComponents: ComponentDefinition[] = [];

    for (const componentData of components) {
      // Safe type narrowing for custom component detection
      const componentName = (componentData as { name?: string })?.name;

      if (!componentName) {
        processedComponents.push(componentData);
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

          // Process nested children if this is a container
          let nestedChildren: unknown[] | undefined;
          if (
            componentWithName.children &&
            Array.isArray(componentWithName.children)
          ) {
            nestedChildren = await processDocumentComponents(
              componentWithName.children as ComponentDefinition[],
              warningsCollector
            );
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
            theme: fullTheme,
            addWarning,
            children: nestedChildren,
          });

          // Ensure result is an array
          const resultComponents = Array.isArray(result) ? result : [result];

          // Recursively process the result in case it contains more custom components
          const processedResult = await processDocumentComponents(
            resultComponents,
            warningsCollector
          );
          processedComponents.push(...processedResult);

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
        // This is a standard component or nested container - process recursively
        if (
          'children' in componentData &&
          Array.isArray(componentData.children)
        ) {
          const processedNested = await processDocumentComponents(
            componentData.children,
            warningsCollector
          );
          processedComponents.push({
            ...componentData,
            children: processedNested,
          });
        } else {
          processedComponents.push(componentData);
        }
      }
    }

    return processedComponents;
  }

  /**
   * Add a custom component to the generator
   */
  function addComponent<TNewComponent extends CustomComponent<any, any, any>>(
    component: TNewComponent
  ): DocumentGeneratorBuilder<readonly [...TComponents, TNewComponent]> {
    // Runtime duplicate check
    if (state.componentNames.has(component.name)) {
      throw new DuplicateComponentError(component.name);
    }

    // createComponent already validates — just check name for safety
    if (!component.name) {
      throw new Error('Component name is required');
    }

    // Create NEW immutable state
    const newComponentNames = new Set(state.componentNames);
    newComponentNames.add(component.name);

    const newState: BuilderState = {
      components: [...state.components, component],
      componentNames: newComponentNames,
      theme: state.theme,
      debug: state.debug,
      enableCache: state.enableCache,
    };

    // Return NEW builder with expanded type
    return createBuilderImpl<readonly [...TComponents, TNewComponent]>(
      newState
    );
  }

  /**
   * Generate a document
   */
  async function generate(
    document: ExtendedReportComponent<TComponents>
  ): Promise<GenerationResult> {
    try {
      // Cast to ReportComponentDefinition for internal processing
      const internalDocument = document as unknown as ReportComponentDefinition;

      // Validate the document first
      validateDocument(
        internalDocument,
        state.components as unknown as CustomComponent<TSchema>[]
      );

      // Initialize warnings collector
      const warnings: GenerationWarning[] = [];

      // Process custom components to convert them to standard components
      const processedComponents = await processDocumentComponents(
        internalDocument.children || [],
        warnings
      );

      // Create a new document definition with processed components
      const processedDocument: ReportComponentDefinition = {
        ...internalDocument,
        children: processedComponents,
      };

      // Normalize components (handle shorthand notations and nested structures)
      // We bypass JSON validation since we've already validated with custom schemas
      const [finalReportComponent] = normalizeDocument(processedDocument);

      // Use the document generation pipeline directly
      const structure = await processDocument(
        finalReportComponent,
        fullTheme,
        'custom'
      );
      const layout = applyLayout(structure.sections, fullTheme, 'custom');
      const generatedDocument = await renderDocument(structure, layout);

      return {
        document: generatedDocument,
        warnings: warnings.length > 0 ? warnings : null,
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
    document: ExtendedReportComponent<TComponents>
  ): Promise<BufferGenerationResult> {
    const { document: doc, warnings } = await generate(document);
    const buffer = await Packer.toBuffer(doc);
    return { buffer, warnings };
  }

  /**
   * Generate a document and save to file
   */
  async function generateFile(
    document: ExtendedReportComponent<TComponents>,
    outputPath: string
  ): Promise<FileGenerationResult> {
    const { buffer, warnings } = await generateBuffer(document);
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
    document: ExtendedReportComponent<TComponents>
  ): ValidationResult {
    try {
      // Cast to ReportComponentDefinition for internal validation
      const internalDocument = document as unknown as ReportComponentDefinition;
      validateDocument(
        internalDocument,
        state.components as unknown as CustomComponent<TSchema>[]
      );
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

  /**
   * Get the compiled standard components definition
   */
  async function getStandardComponentsDefinition(
    document: ExtendedReportComponent<TComponents>
  ): Promise<ReportComponentDefinition> {
    try {
      // Cast to ReportComponentDefinition for internal processing
      const internalDocument = document as unknown as ReportComponentDefinition;

      // Validate the document first
      validateDocument(
        internalDocument,
        state.components as unknown as CustomComponent<TSchema>[]
      );

      // Initialize warnings collector (not returned by this function)
      const warnings: GenerationWarning[] = [];

      // Process custom components to convert them to standard components
      const processedComponents = await processDocumentComponents(
        internalDocument.children || [],
        warnings
      );

      // Create a new document definition with processed components
      const processedDocument: ReportComponentDefinition = {
        ...internalDocument,
        children: processedComponents,
      };

      // Normalize components (handle shorthand notations and nested structures)
      // We bypass JSON validation since we've already validated with custom schemas
      const [finalReportComponent] = normalizeDocument(processedDocument);

      // Return the normalized document with all custom components resolved to standard components
      return finalReportComponent;
    } catch (error) {
      if (state.debug) {
        console.error('Error getting standard components definition:', error);
      }
      throw error;
    }
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
    debug: options.debug ?? false,
    enableCache: options.enableCache ?? false,
  };

  return createBuilderImpl<readonly []>(initialState);
}
