/**
 * Report Component Schema
 */

import { Type, Static, TSchema } from '@sinclair/typebox';

// Create a function to generate ReportPropsSchema with recursive component reference
export const createReportPropsSchema = (_moduleRef?: TSchema) =>
  Type.Object(
    {
      theme: Type.Optional(
        Type.String({
          description: 'Theme name to apply (default: "minimal")',
          examples: ['corporate', 'professional', 'minimal'],
          default: 'minimal',
        })
      ),
      metadata: Type.Optional(
        Type.Object(
          {
            title: Type.Optional(
              Type.String({
                description: 'Document title',
                examples: ['Annual Report 2024', 'Technical Documentation'],
              })
            ),
            subtitle: Type.Optional(
              Type.String({
                description: 'Document subtitle',
              })
            ),
            description: Type.Optional(Type.String()),
            author: Type.Optional(Type.String()),
            company: Type.Optional(Type.String()),
            date: Type.Optional(Type.String()),
            created: Type.Optional(Type.String({ format: 'date-time' })),
            modified: Type.Optional(Type.String({ format: 'date-time' })),
            version: Type.Optional(Type.String()),
            tags: Type.Optional(Type.Array(Type.String())),
          },
          {
            description:
              'Document metadata (title, author, company, dates, etc.)',
            additionalProperties: false,
          }
        )
      ),
    },
    {
      description: 'Report component props',
      additionalProperties: false,
    }
  );

export const ReportPropsSchema = createReportPropsSchema();

export type ReportProps = Static<typeof ReportPropsSchema>;
