/**
 * Plugin system for json-to-docx
 *
 * Provides a functional, type-safe way to create versioned custom components
 * that can be composed into document generators using a builder pattern.
 *
 * @example
 * ```typescript
 * import { createComponent, createVersion, createDocumentGenerator } from '@json-to-docx/core/plugin';
 * import { Type } from '@sinclair/typebox';
 *
 * const weatherComponent = createComponent({
 *   name: 'weather',
 *   versions: {
 *     '1.0.0': createVersion({
 *       propsSchema: Type.Object({ city: Type.String() }),
 *       render: async ({ props }) => [{
 *         name: 'paragraph',
 *         props: { text: `Weather in ${props.city}` }
 *       }]
 *     })
 *   }
 * });
 *
 * const generator = createDocumentGenerator({ theme: myTheme })
 *   .addComponent(weatherComponent);
 * ```
 */

export {
  createComponent,
  createVersion,
  type CustomComponent,
  type ComponentVersion,
  type ComponentVersionMap,
  type RenderFunction,
  type RenderContext,
} from './createComponent';

export {
  createDocumentGenerator,
  type DocumentGeneratorOptions,
} from './createDocumentGenerator';

export {
  type DocumentGenerator,
  type DocumentGeneratorBuilder,
  type GenerationResult,
  type BufferGenerationResult,
  type FileGenerationResult,
  type ValidationResult,
  type ExtractCustomComponentType,
  type CustomComponentUnion,
  type ExtendedComponentDefinition,
  type ExtendedReportComponent,
  type InferCustomComponents,
  type InferBuilderComponents,
  type InferDocumentType,
  type InferComponentDefinition,
} from './types';

export {
  validateComponentProps,
  validateDocument,
  cleanComponentProps,
  ComponentValidationError,
  DuplicateComponentError,
  type ValidationError,
} from './validation';

export {
  generatePluginDocumentSchema,
  exportPluginSchema,
  generateComponentSchemas,
  mergeSchemas,
  createUnionSchema,
} from './schema';

export { resolveComponentVersion } from './version-resolver';
