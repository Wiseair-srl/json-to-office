/**
 * Plugin system for json-to-pptx
 *
 * @example
 * ```typescript
 * import { createComponent, createVersion, createPresentationGenerator } from '@json-to-office/core-pptx/plugin';
 * import { Type } from '@sinclair/typebox';
 *
 * const bannerComponent = createComponent({
 *   name: 'banner' as const,
 *   versions: {
 *     '1.0.0': createVersion({
 *       propsSchema: Type.Object({ title: Type.String() }),
 *       render: async ({ props }) => [{
 *         name: 'text',
 *         props: { text: props.title, x: 0.5, y: 0.5, w: 9, h: 1 }
 *       }]
 *     })
 *   }
 * });
 *
 * const generator = createPresentationGenerator()
 *   .addComponent(bannerComponent);
 * ```
 */

// Component creation (from shared)
export {
  createComponent,
  createVersion,
  type CustomComponent,
  type ComponentVersion,
  type ComponentVersionMap,
  type RenderFunction,
  type RenderContext,
} from '@json-to-office/shared/plugin';

// Generator
export {
  createPresentationGenerator,
  type PresentationGeneratorOptions,
} from './createPresentationGenerator';

// Types
export {
  type PresentationGenerator,
  type PresentationGeneratorBuilder,
  type BufferGenerationResult,
  type FileGenerationResult,
  type ValidationResult,
  type ExtractCustomComponentType,
  type CustomComponentUnion,
  type ExtendedPptxComponentInput,
  type ExtendedPresentationComponent,
  type InferBuilderComponents,
  type InferDocumentType,
  type InferComponentDefinition,
} from './types';

// Validation
export {
  validateComponentProps,
  validatePresentation,
  cleanComponentProps,
  ComponentValidationError,
  DuplicateComponentError,
  type ValidationError,
  type ComponentValidationResult,
} from './validation';

// Schema
export { generatePluginPresentationSchema, exportPluginSchema } from './schema';

// Version resolution (from shared)
export { resolveComponentVersion } from '@json-to-office/shared/plugin';
