/**
 * Report Component Schema
 */

import { Type, Static, TSchema } from '@sinclair/typebox';
import { ComponentDefaultsSchema } from '../component-defaults';
import { NoProofWordsSchema } from '../font';

// Create a function to generate ReportPropsSchema with recursive component reference
export const createReportPropsSchema = (_componentRef?: TSchema) =>
  Type.Object(
    {
      theme: Type.Optional(
        Type.String({
          description: 'Theme name to apply (default: "minimal")',
          examples: ['minimal', 'corporate', 'modern'],
          default: 'minimal',
        })
      ),
      componentDefaults: Type.Optional(ComponentDefaultsSchema),
      language: Type.Optional(
        Type.String({
          pattern: '^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$',
          description:
            'Default document language (BCP-47 tag, e.g. "en-US"). Sets Word\'s default proofing/spell-check language; individual components can override it locally.',
          examples: ['en-US', 'fr-FR', 'de-DE', 'it-IT', 'es-ES'],
        })
      ),
      noProofWords: Type.Optional(NoProofWordsSchema),
      trackRevisions: Type.Optional(
        Type.Boolean({
          description:
            'Open the document in track-changes mode: Word marks any further edits as revisions. Set automatically on redline documents produced by the diff engine',
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
            company: Type.Optional(
              Type.String({
                description:
                  'Company name, written to docProps/custom.xml (Word has no core-property slot for it)',
              })
            ),
            date: Type.Optional(
              Type.String({
                description:
                  'Document date used by {DATE}/{DATETIME} placeholders (defaults to the generation timestamp)',
              })
            ),
            version: Type.Optional(
              Type.String({
                description: 'Document version, written to docProps/custom.xml',
                examples: ['1.0', '2024.3'],
              })
            ),
            tags: Type.Optional(Type.Array(Type.String())),
          },
          {
            description:
              'Document metadata (title, author, company, version, etc.). Package timestamps (dcterms:created/modified) are not part of this object: they come from the `generatedAt` generation option so repeated builds stay byte-identical.',
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
