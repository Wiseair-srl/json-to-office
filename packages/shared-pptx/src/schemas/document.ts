/**
 * PPTX Document Schema Definitions
 */

import { Static } from '@sinclair/typebox';
import { PptxComponentDefinitionSchema } from './components';

export const PptxJsonComponentDefinitionSchema = PptxComponentDefinitionSchema;

export type PptxJsonComponentDefinition = Static<
  typeof PptxJsonComponentDefinitionSchema
>;

export const PPTX_JSON_SCHEMA_URLS = {
  presentation: './json-schemas/components/presentation.schema.json',
  slide: './json-schemas/components/slide.schema.json',
  text: './json-schemas/components/text.schema.json',
  image: './json-schemas/components/image.schema.json',
  shape: './json-schemas/components/shape.schema.json',
  table: './json-schemas/components/table.schema.json',
  index: './json-schemas/index.schema.json',
};
