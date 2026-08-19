/**
 * API Schema Definitions using TypeBox
 * This file provides TypeBox schemas for API request/response validation
 */

import { Type, Static } from '@sinclair/typebox';
import { ComponentDefinitionSchema } from './components';

// ============================================================================
// API Request Schemas
// ============================================================================

export const GenerateDocumentRequestSchema = Type.Object(
  {
    definition: ComponentDefinitionSchema,
    format: Type.Optional(
      Type.Union([
        Type.Literal('docx'),
        Type.Literal('pdf'),
        Type.Literal('html'),
      ])
    ),
    options: Type.Optional(
      Type.Object(
        {
          includeMetadata: Type.Optional(Type.Boolean()),
          // No `includeComments`: comments are authored on the components that
          // carry them, so there is nothing for a request-level toggle to mean.
          // The object stays `additionalProperties: true`, so old callers that
          // still send one are unaffected.
          trackChanges: Type.Optional(Type.Boolean()),
        },
        { additionalProperties: true }
      )
    ),
  },
  {
    additionalProperties: false,
    description: 'Document generation request',
  }
);

export const ValidateDocumentRequestSchema = Type.Object(
  {
    definition: Type.Unknown(),
    strict: Type.Optional(Type.Boolean()),
  },
  {
    additionalProperties: false,
    description: 'Document validation request',
  }
);

// ============================================================================
// API Response Schemas
// ============================================================================

export const GenerateDocumentResponseSchema = Type.Object(
  {
    success: Type.Boolean(),
    documentId: Type.Optional(Type.String()),
    downloadUrl: Type.Optional(Type.String()),
    error: Type.Optional(Type.String()),
    metadata: Type.Optional(
      Type.Object(
        {
          pageCount: Type.Optional(Type.Number()),
          wordCount: Type.Optional(Type.Number()),
          generatedAt: Type.Optional(Type.String({ format: 'date-time' })),
        },
        { additionalProperties: true }
      )
    ),
  },
  {
    additionalProperties: false,
    description: 'Document generation response',
  }
);

export const ValidateDocumentResponseSchema = Type.Object(
  {
    valid: Type.Boolean(),
    errors: Type.Array(
      Type.Object({
        path: Type.String(),
        message: Type.String(),
        code: Type.Optional(Type.String()),
      })
    ),
    warnings: Type.Optional(
      Type.Array(
        Type.Object({
          path: Type.String(),
          message: Type.String(),
          code: Type.Optional(Type.String()),
        })
      )
    ),
  },
  {
    additionalProperties: false,
    description: 'Document validation response',
  }
);

// ============================================================================
// TypeScript Types
// ============================================================================

export type GenerateDocumentRequest = Static<
  typeof GenerateDocumentRequestSchema
>;
export type ValidateDocumentRequest = Static<
  typeof ValidateDocumentRequestSchema
>;
export type GenerateDocumentResponse = Static<
  typeof GenerateDocumentResponseSchema
>;
export type ValidateDocumentResponse = Static<
  typeof ValidateDocumentResponseSchema
>;
