/**
 * PPTX Schema Export
 */
import type { TSchema } from '@sinclair/typebox';
import { convertToJsonSchema as convertSharedToJsonSchema } from '@json-to-office/shared';
import {
  addPptxBlockAuthoringSchemas,
  dispatchPptxRootByRenderer,
} from './block-authoring';

/**
 * The shared TypeBox → JSON Schema export, enriched with the PPTX block-body
 * authoring schemas. Every producer of the published presentation schema —
 * the playground, the CLI, the MCP server, the checked-in schema file — goes
 * through this so an editor sees the same block completion everywhere.
 */
export function convertToJsonSchema(
  schema: TSchema,
  options: Omit<
    NonNullable<Parameters<typeof convertSharedToJsonSchema>[1]>,
    'enrich'
  > = {}
): Record<string, unknown> {
  return convertSharedToJsonSchema(schema, {
    ...options,
    enrich: (json) => {
      addPptxBlockAuthoringSchemas(json);
      dispatchPptxRootByRenderer(json);
    },
  });
}

export const PPTX_COMPONENT_METADATA: Record<
  string,
  { title: string; description: string; enhanceForRichContent?: boolean }
> = {
  presentation: {
    title: 'Presentation Component',
    description: 'Top-level presentation container with metadata and settings',
  },
  slide: {
    title: 'Slide Component',
    description: 'Slide container for organizing content elements',
  },
  text: {
    title: 'Text Component',
    description: 'Text element with formatting and positioning',
  },
  image: {
    title: 'Image Component',
    description: 'Image element with sizing and positioning',
  },
  shape: {
    title: 'Shape Component',
    description: 'Geometric shape with optional text and styling',
  },
  table: {
    title: 'Table Component',
    description: 'Tabular data display with rows and columns',
  },
};

export const PPTX_BASE_SCHEMA_METADATA: Record<
  string,
  { title: string; description: string }
> = {
  position: {
    title: 'Position',
    description: 'Position and size in inches or percentages',
  },
  'slide-background': {
    title: 'Slide Background',
    description: 'Slide background configuration',
  },
  transition: {
    title: 'Transition',
    description: 'Slide transition effect configuration',
  },
  shadow: {
    title: 'Shadow',
    description: 'Shadow configuration for elements',
  },
};
