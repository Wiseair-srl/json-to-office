/**
 * Custom Component Schema Definitions using TypeBox
 *
 * Schemas for custom components that extend the base document generation capabilities.
 * These are kept separate from base components but still part of the shared package
 * to maintain a single source of truth for all schemas.
 */

import { Type, Static } from '@sinclair/typebox';

// ============================================================================
// Text Space After Custom Component
// ============================================================================

/**
 * Text Space After component props
 * Simple custom component that adds spacing after text content
 */
export const TextSpaceAfterPropsSchema = Type.Object({
  content: Type.String({
    description: 'Text content (required)',
  }),
  spaceAfter: Type.Optional(
    Type.Number({
      minimum: 0,
      description: 'Spacing after text in points',
    })
  ),
  fontSize: Type.Optional(Type.Number({ minimum: 1 })),
  fontFamily: Type.Optional(Type.String()),
  bold: Type.Optional(Type.Boolean()),
  italic: Type.Optional(Type.Boolean()),
  underline: Type.Optional(Type.Boolean()),
  color: Type.Optional(
    Type.String({
      pattern: '^#[0-9A-Fa-f]{6}$',
    })
  ),
  alignment: Type.Optional(
    Type.Union([
      Type.Literal('left'),
      Type.Literal('center'),
      Type.Literal('right'),
      Type.Literal('justify'),
    ])
  ),
});

/**
 * Text Space After component definition schema
 */
export const TextSpaceAfterComponentSchema = Type.Object({
  name: Type.Literal('text-space-after'),
  id: Type.Optional(Type.String()),
  props: TextSpaceAfterPropsSchema,
});

// ============================================================================
// Combined Custom Components Union
// ============================================================================

/**
 * Union of all custom component types
 */
export const CustomComponentDefinitionSchema = TextSpaceAfterComponentSchema;

// ============================================================================
// Type Exports
// ============================================================================

// Text Space After types
export type TextSpaceAfterProps = Static<typeof TextSpaceAfterPropsSchema>;
export type TextSpaceAfterComponent = Static<
  typeof TextSpaceAfterComponentSchema
>;

// Combined custom component type
export type CustomComponentDefinition = Static<
  typeof CustomComponentDefinitionSchema
>;
