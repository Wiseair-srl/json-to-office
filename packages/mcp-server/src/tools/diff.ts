/**
 * `jto_docx_diff` — two document definitions in, one reviewable redline out.
 *
 * The redline is a third DOCX definition whose text changes are `revision`
 * segments, which the renderer turns into native Word tracked changes: the
 * file opens in Word with real insertions and deletions a human can accept or
 * reject, not coloured text pretending to be them.
 *
 * Some changes have no native revision at Word's fidelity — a replaced table,
 * a swapped image. The engine reports those as `summary.untracked` rather than
 * silently dropping them, and this tool passes them through unchanged: an
 * agent that only reads the file would otherwise never learn that part of the
 * diff is invisible in it.
 */

import type { McpServer } from '@modelcontextprotocol/server';
import {
  diffDocuments,
  type DiffDocumentsOptions,
  type JsonNode,
} from '@json-to-office/shared-docx';

import { checkRenderer, type GeneratorOptions } from '../lib/adapters.js';
import { MIME_TYPES, deliverArtifact } from '../lib/artifacts.js';
import type { ToolDeps } from '../lib/deps.js';
import { resolveDocumentSource, sourceSummary } from '../lib/doc-source.js';
import {
  ERROR_CODES,
  OPTION_ERROR_CODES,
  countDiagnostics,
  diagnosticsFromThrown,
  failure,
  failureFrom,
  guarded,
  toolResult,
  validationDiagnostics,
  type Diagnostic,
} from '../lib/errors.js';
import {
  checkDateOption,
  checkGeneratedAt,
  resolveThemePathOption,
} from '../lib/render-options.js';
import {
  S,
  artifactOutputProperties,
  artifactSchema,
  documentSourceSchema,
  outputSchema,
  renderOptionProperties,
  sourceSummarySchema,
  type ArtifactOutputInput,
  type DocumentSourceInput,
  type RenderOptionsInput,
} from '../lib/schema.js';

/** Word shows this next to every revision when the caller names nobody. */
const DEFAULT_AUTHOR = 'json-to-office';

const DEFAULT_FILENAME = 'redline.docx';

/** One side of the comparison: a source wrapper, or the document itself. */
type DiffSide = DocumentSourceInput & { name?: unknown };

interface DiffArgs extends RenderOptionsInput, ArtifactOutputInput {
  before: DiffSide;
  after: DiffSide;
  author?: string;
  date?: string;
  dryRun?: boolean;
  includeRedlineDocument?: boolean;
}

/**
 * A side, as advertised.
 *
 * Two documents cannot both be spelled `document`, so each side is a bag of
 * `documentSourceProperties` — and that made this the one tool in the set that
 * rejected the shape the other twelve accept, with an AJV message naming no
 * property. It now takes either: `additionalProperties` is open so a document
 * definition passes straight through, and the wrapper keys stay advertised
 * flat, which a `oneOf` would hide from every client that renders nothing but
 * a property list.
 */
const diffSideSchema = {
  ...documentSourceSchema,
  additionalProperties: true,
};

/**
 * One side, as `resolveDocumentSource` wants it.
 *
 * A bare document is recognised by its `name`, which every document definition
 * has at its root and no wrapper has at all. Anything else stays a wrapper, so
 * `{}` and a misspelled key still come back as E_DOC_SOURCE_MISSING naming the
 * two spellings that work, rather than being validated as a document nobody
 * sent.
 */
function documentSourceOf(side: DiffSide): DocumentSourceInput {
  if (side.document !== undefined || side.handle !== undefined) return side;
  return typeof side.name === 'string' ? { document: side } : side;
}

const untrackedChangeSchema = {
  type: 'object' as const,
  description: 'A change the redline cannot express as a native Word revision.',
  properties: {
    path: {
      type: 'string' as const,
      description: 'RFC 6901 JSON Pointer into the AFTER document.',
    },
    kind: {
      type: 'string' as const,
      enum: ['modified', 'inserted', 'deleted'],
    },
    component: { type: 'string' as const },
    detail: { type: 'string' as const },
  },
  required: ['path', 'kind', 'component', 'detail'],
  additionalProperties: false,
};

const summarySchema = {
  type: 'object' as const,
  properties: {
    tracked: {
      type: 'object' as const,
      description: 'Blocks rendered as native tracked changes.',
      properties: {
        modified: { type: 'integer' as const },
        inserted: { type: 'integer' as const },
        deleted: { type: 'integer' as const },
      },
      required: ['modified', 'inserted', 'deleted'],
      additionalProperties: false,
    },
    untracked: { type: 'array' as const, items: untrackedChangeSchema },
    unchangedBlocks: { type: 'integer' as const },
    notes: {
      type: 'array' as const,
      description: 'Fidelity caveats about the redline as a whole.',
      items: { type: 'string' as const },
    },
  },
  required: ['tracked', 'untracked', 'unchangedBlocks', 'notes'],
  additionalProperties: false,
};

/** Tag a side's diagnostics so a caller knows which document to repair. */
function sideDiagnostics(
  side: 'before' | 'after',
  diagnostics: Diagnostic[]
): Diagnostic[] {
  return diagnostics.map((entry) => ({
    ...entry,
    context: { ...entry.context, side },
  }));
}

export function register(server: McpServer, deps: ToolDeps): void {
  server.registerTool(
    'jto_docx_diff',
    {
      title: 'Diff two documents into a Word redline',
      description:
        'Compare two DOCX document definitions and produce a redline .docx that opens in Word with native tracked changes, plus a structured summary of what changed. DOCX only. Changes with no native Word revision (tables, images, charts) are reported under `summary.untracked` — read it, because they are invisible as revisions in the file itself. Pass `dryRun: true` for the summary without rendering.',
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: true,
      },
      inputSchema: S<DiffArgs>({
        type: 'object',
        properties: {
          before: {
            ...diffSideSchema,
            description:
              'The base document: the document JSON itself, or a source wrapper — `{"document": <json>}` or `{"handle": "ws_..."}`.',
          },
          after: {
            ...diffSideSchema,
            description:
              'The revised document: the document JSON itself, or a source wrapper — `{"document": <json>}` or `{"handle": "ws_..."}`.',
          },
          author: {
            type: 'string',
            description: `Revision author shown in Word (default "${DEFAULT_AUTHOR}").`,
          },
          date: {
            type: 'string',
            description:
              'Revision timestamp, ISO 8601. Omit for a deterministic redline: two runs over the same pair then produce the same bytes.',
          },
          dryRun: {
            type: 'boolean',
            description:
              'Compute the diff and summary without rendering or writing the redline.',
          },
          includeRedlineDocument: {
            type: 'boolean',
            description:
              'Also return the redline document JSON, so it can be edited before rendering.',
          },
          ...renderOptionProperties,
          ...artifactOutputProperties,
        },
        required: ['before', 'after'],
        additionalProperties: false,
      }),
      outputSchema: S(
        outputSchema({
          summary: summarySchema,
          artifact: artifactSchema,
          redline: {
            type: 'object',
            description:
              'The redline document JSON. Present only when `includeRedlineDocument` was set.',
            additionalProperties: true,
          },
          dryRun: { type: 'boolean' },
          before: sourceSummarySchema,
          after: sourceSummarySchema,
        })
      ),
    },
    async (args) =>
      toolResult(
        await guarded(async () => {
          // The engine emits `revision` segments only the DOCX renderer knows
          // how to turn into w:ins / w:del, so there is no PPTX equivalent to
          // fall back to.
          const adapter = deps.getAdapter('docx');
          if (adapter.name !== 'docx') {
            return failure(
              OPTION_ERROR_CODES.UNSUPPORTED_FORMAT,
              'jto_docx_diff supports DOCX documents only.'
            );
          }

          const rendererError = await checkRenderer(adapter, args.renderer);
          if (rendererError) return rendererError;

          const generatedAtError = checkGeneratedAt(args.generatedAt);
          if (generatedAtError) return generatedAtError;

          const themePath = resolveThemePathOption(
            args.themePath,
            args.baseDir
          );
          if (!themePath.ok) return themePath;

          const store = deps.workspaces();
          const before = await resolveDocumentSource(
            documentSourceOf(args.before),
            store
          );
          if (!before.ok) {
            return failureFrom(sideDiagnostics('before', before.diagnostics));
          }
          const after = await resolveDocumentSource(
            documentSourceOf(args.after),
            store
          );
          if (!after.ok) {
            return failureFrom(sideDiagnostics('after', after.diagnostics));
          }
          const sources = {
            before: sourceSummary(before),
            after: sourceSummary(after),
          };

          // Both sides are validated up front, as `jto docx diff` does: the
          // diff walks the trees structurally and would otherwise produce a
          // confident redline out of a document that cannot render.
          const inputDiagnostics = [
            ...sideDiagnostics(
              'before',
              validationDiagnostics(
                adapter.validateDocument(before.document).errors
              )
            ),
            ...sideDiagnostics(
              'after',
              validationDiagnostics(
                adapter.validateDocument(after.document).errors
              )
            ),
          ];
          if (countDiagnostics(inputDiagnostics).error > 0) {
            return { ...failureFrom(inputDiagnostics), ...sources };
          }

          const dateError = checkDateOption(
            'date',
            args.date,
            'omit it for a deterministic redline.'
          );
          if (dateError) return { ...dateError, ...sources };
          const date =
            args.date === undefined
              ? undefined
              : new Date(args.date).toISOString();

          const diffOptions: DiffDocumentsOptions = {
            author: args.author ?? DEFAULT_AUTHOR,
            ...(date !== undefined && { date }),
          };
          const { document, summary } = diffDocuments(
            before.document as JsonNode,
            after.document as JsonNode,
            diffOptions
          );

          const common = {
            diagnostics: inputDiagnostics,
            summary,
            ...sources,
            ...(args.includeRedlineDocument === true && { redline: document }),
          };

          if (args.dryRun === true) {
            return { ok: true, ...common, dryRun: true };
          }

          const options: GeneratorOptions = {
            ...(args.renderer !== undefined && { renderer: args.renderer }),
            ...(args.theme !== undefined && { theme: args.theme }),
            ...(themePath.path !== undefined && { themePath: themePath.path }),
            ...(args.deterministic !== undefined && {
              deterministic: args.deterministic,
            }),
            ...(args.generatedAt !== undefined && {
              generatedAt: args.generatedAt,
            }),
            ...(args.baseDir !== undefined && { baseDir: args.baseDir }),
          };

          let buffer: Buffer;
          try {
            const generator = await adapter.createGenerator([], options);
            buffer = await generator.generateBuffer(document);
          } catch (error) {
            const diagnostics = diagnosticsFromThrown(error);
            if (!diagnostics) throw error;
            return {
              ok: false,
              ...common,
              diagnostics: [...inputDiagnostics, ...diagnostics],
              dryRun: false,
            };
          }

          const mimeType = MIME_TYPES[adapter.extension];
          if (mimeType === undefined) {
            return {
              ...failure(
                ERROR_CODES.INTERNAL,
                `No MIME type registered for "${adapter.extension}".`
              ),
              ...sources,
            };
          }
          const delivered = await deliverArtifact(buffer, {
            filename: args.filename ?? DEFAULT_FILENAME,
            mimeType,
            ...(args.outputMode !== undefined && { mode: args.outputMode }),
            outputRoot: deps.outputRoot,
            maxInlineBytes: deps.maxInlineArtifactBytes,
          });
          if (!delivered.ok) {
            return {
              ok: false,
              ...common,
              diagnostics: [...inputDiagnostics, ...delivered.diagnostics],
              dryRun: false,
            };
          }

          return {
            ok: true,
            ...common,
            artifact: delivered.artifact,
            dryRun: false,
          };
        })
      )
  );
}
