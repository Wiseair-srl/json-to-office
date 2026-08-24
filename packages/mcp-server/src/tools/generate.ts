/**
 * `jto_generate` — document JSON in, a real .docx or .pptx out.
 *
 * The file is a build product: the same JSON, renderer, theme, fonts and
 * options always produce it again, which is why the artifact comes back as a
 * path under the server's output root by default rather than as bytes an agent
 * has to carry around in its context.
 *
 * Everything the render learned on the way — an unresolvable font, a theme
 * name that matched nothing — arrives as warning-severity diagnostics in the
 * same envelope as a validation failure, so a caller has exactly one place to
 * look whether generation refused or merely compromised.
 */

import type { McpServer, ServerContext } from '@modelcontextprotocol/server';
import type { GenerationWarning } from '@json-to-office/shared';

import {
  checkRenderer,
  type FormatName,
  type GeneratorOptions,
} from '../lib/adapters.js';
import { MIME_TYPES, deliverArtifact } from '../lib/artifacts.js';
import type { ToolDeps } from '../lib/deps.js';
import {
  condenseDiagnostics,
  maxDiagnosticsProperty,
  truncatedProperty,
} from '../lib/diagnostic-budget.js';
import { resolveDocumentSource, sourceSummary } from '../lib/doc-source.js';
import {
  ERROR_CODES,
  diagnostic,
  diagnosticsFromThrown,
  failure,
  guarded,
  normalizeWarningCode,
  toolResult,
  type Diagnostic,
} from '../lib/errors.js';
import {
  checkGeneratedAt,
  resolveThemePathOption,
  themeDiagnostics,
} from '../lib/render-options.js';
import {
  S,
  artifactOutputProperties,
  artifactSchema,
  documentSourceProperties,
  formatSchema,
  outputSchema,
  renderOptionProperties,
  sourceSummarySchema,
  type ArtifactOutputInput,
  type DocumentSourceInput,
  type RenderOptionsInput,
} from '../lib/schema.js';

/** Steps reported through the progress token, when the client sent one. */
const PROGRESS_TOTAL = 3;

/**
 * Emit progress, or don't.
 *
 * Only when the client actually asked for it — an unsolicited progress
 * notification is protocol noise — and never fatally: a client that cannot
 * take the notification must still get its document.
 */
async function reportProgress(
  ctx: ServerContext,
  progress: number,
  message: string
): Promise<void> {
  const progressToken = ctx.mcpReq._meta?.progressToken;
  if (progressToken === undefined) return;
  try {
    await ctx.mcpReq.notify({
      method: 'notifications/progress',
      params: { progressToken, progress, total: PROGRESS_TOTAL, message },
    });
  } catch {
    /* progress is advisory; losing it must not lose the generation */
  }
}

function cancelled(format: FormatName): Diagnostic[] {
  return [
    diagnostic(
      ERROR_CODES.CANCELLED,
      `Generation of the ${format} document was cancelled by the client.`,
      { context: { format } }
    ),
  ];
}

/**
 * A generation warning, as a diagnostic.
 *
 * The cores carry their own stable code inside `context.code`
 * (FONT_UNRESOLVED and friends). It reaches `code` through
 * `normalizeWarningCode`, which prefixes it into the published `W_` namespace
 * rather than passing it through bare: the prefix is what tells an agent the
 * diagnostic does not block, and these are precisely the diagnostics it may
 * always continue past. `context.code` keeps the core's own spelling, so a
 * caller matching this against what the CLI prints still has it. The component
 * rides along because these carry no path.
 */
function warningDiagnostic(warning: GenerationWarning): Diagnostic {
  const code = normalizeWarningCode(
    typeof warning.context?.code === 'string' ? warning.context.code : undefined
  );
  return diagnostic(code, warning.message, {
    severity: warning.severity === 'info' ? 'info' : 'warning',
    context: { component: warning.component, ...warning.context },
  });
}

interface FontOptionsInput {
  strict?: boolean;
  mode?: 'substitute' | 'custom';
  substitution?: Record<string, string>;
  baseDir?: string;
  googleFonts?: {
    enabled?: boolean;
    fetchTimeoutMs?: number;
  };
}

interface GenerateArgs
  extends DocumentSourceInput,
    RenderOptionsInput,
    ArtifactOutputInput {
  format: FormatName;
  fonts?: FontOptionsInput;
  validation?: { allowUnknownFields?: boolean };
  maxDiagnostics?: number;
}

/**
 * Apply the caller's diagnostic budget to whatever the body returned.
 *
 * Every exit — a refused option, a rejected document, a success carrying
 * warnings — answers with the same `diagnostics` array, so the cap belongs at
 * the one place they all pass through rather than repeated at each `return`.
 */
function withDiagnosticBudget<T extends { diagnostics: Diagnostic[] }>(
  payload: T,
  limit: number | undefined
): T & { truncated: boolean } {
  const { kept, truncated } = condenseDiagnostics(payload.diagnostics, limit);
  return { ...payload, diagnostics: kept, truncated };
}

const fontsSchema = {
  type: 'object' as const,
  description: 'Font resolution for this render.',
  properties: {
    strict: {
      type: 'boolean' as const,
      description: 'Promote unresolved-font warnings to a generation failure.',
    },
    mode: {
      type: 'string' as const,
      enum: ['custom', 'substitute'],
      description:
        '`custom` (default) keeps font references as written; `substitute` rewrites every non-safe family to a widely installed equivalent so the file renders identically everywhere.',
    },
    substitution: {
      type: 'object' as const,
      description:
        'Family-name replacements applied when `mode` is `substitute`. Unlisted families fall back to a category-based default.',
      additionalProperties: { type: 'string' as const },
    },
    baseDir: {
      type: 'string' as const,
      description: 'Directory that font file paths resolve against.',
    },
    googleFonts: {
      type: 'object' as const,
      properties: {
        enabled: {
          type: 'boolean' as const,
          description: 'Set false to forbid network font fetches.',
        },
        fetchTimeoutMs: { type: 'integer' as const, minimum: 1 },
      },
      additionalProperties: false,
    },
  },
  additionalProperties: false,
};

export function register(server: McpServer, deps: ToolDeps): void {
  server.registerTool(
    'jto_generate',
    {
      title: 'Generate a document',
      description:
        'Render a document to a real .docx or .pptx. The file is written under the server output root and returned as a path; pass `outputMode: "base64"` only for small artifacts. A document that fails the generation gate comes back with `ok: false` and the same path-addressed diagnostics jto_validate reports, never as an error. Warnings the render emitted (unresolved fonts, a `theme` or `props.theme` naming nothing) arrive as warning-severity diagnostics alongside a successful artifact. The DOCX `highcharts` component draws through a Highcharts export server that must be running on the host (see jto_info.previewDependencies.highchartsExportServer); the `visual` component needs no such service.',
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: true,
      },
      inputSchema: S<GenerateArgs>({
        type: 'object',
        properties: {
          format: formatSchema,
          ...documentSourceProperties,
          ...renderOptionProperties,
          ...artifactOutputProperties,
          fonts: fontsSchema,
          validation: {
            type: 'object',
            description: 'Overrides for the pre-render validation gate.',
            properties: {
              allowUnknownFields: {
                type: 'boolean',
                description:
                  'Tolerate properties the schema does not know instead of refusing to render.',
              },
            },
            additionalProperties: false,
          },
          maxDiagnostics: maxDiagnosticsProperty,
        },
        required: ['format'],
        additionalProperties: false,
      }),
      outputSchema: S(
        outputSchema({
          format: formatSchema,
          renderer: {
            type: 'string',
            description: 'The renderer that produced the file, when requested.',
          },
          theme: {
            type: 'string',
            description:
              "Theme forced on the document, when one was requested. Absent when each document's own `props.theme` decided — and also when the name matched nothing, which comes back as a W_UNKNOWN_THEME diagnostic.",
          },
          artifact: artifactSchema,
          source: sourceSummarySchema,
          truncated: truncatedProperty,
        })
      ),
    },
    async (args, ctx) =>
      toolResult(
        withDiagnosticBudget(
          await guarded(async () => {
            const adapter = deps.getAdapter(args.format);
            const base = { format: args.format };

            if (ctx.mcpReq.signal.aborted) {
              return {
                ok: false,
                diagnostics: cancelled(args.format),
                ...base,
              };
            }

            const rendererError = await checkRenderer(adapter, args.renderer);
            if (rendererError) return { ...rendererError, ...base };

            const dateError = checkGeneratedAt(args.generatedAt);
            if (dateError) return { ...dateError, ...base };

            const themePath = resolveThemePathOption(
              args.themePath,
              args.baseDir
            );
            if (!themePath.ok) return { ...themePath, ...base };

            await reportProgress(ctx, 0, 'Resolving document');
            const resolved = await resolveDocumentSource(
              args,
              deps.workspaces()
            );
            if (!resolved.ok) return { ...resolved, ...base };
            const source = sourceSummary(resolved);

            // One array per request: the adapters PUSH into this sink and never
            // replace it, so a shared array would report a previous document's
            // font problems against this one.
            const warnings: GenerationWarning[] = [];
            const options: GeneratorOptions = {
              ...(args.renderer !== undefined && { renderer: args.renderer }),
              ...(args.theme !== undefined && { theme: args.theme }),
              ...(themePath.path !== undefined && {
                themePath: themePath.path,
              }),
              ...(args.deterministic !== undefined && {
                deterministic: args.deterministic,
              }),
              ...(args.generatedAt !== undefined && {
                generatedAt: args.generatedAt,
              }),
              ...(args.baseDir !== undefined && { baseDir: args.baseDir }),
              ...(args.fonts !== undefined && { fonts: args.fonts }),
              ...(args.validation !== undefined && {
                validation: args.validation,
              }),
              warnings,
            };

            await reportProgress(ctx, 1, `Rendering the ${adapter.label}`);
            let buffer: Buffer;
            let themeLabel: string | undefined;
            try {
              // `createGenerator` rather than `generateBuffer`: it resolves the
              // theme once and reports what it settled on, which is the only way
              // to tell the caller which theme actually rendered.
              const generator = await adapter.createGenerator([], options);
              themeLabel = generator.themeLabel;
              buffer = await generator.generateBuffer(resolved.document);
            } catch (error) {
              const diagnostics = diagnosticsFromThrown(error);
              // Not a rejected document: let `guarded` call it what it is.
              if (!diagnostics) throw error;
              return {
                ok: false,
                diagnostics: [
                  ...diagnostics,
                  ...warnings.map(warningDiagnostic),
                ],
                ...base,
                source,
              };
            }

            // Checked before the write, not after: a cancelled request should
            // not leave a file behind for nobody.
            if (ctx.mcpReq.signal.aborted) {
              return {
                ok: false,
                diagnostics: cancelled(args.format),
                ...base,
                source,
              };
            }

            await reportProgress(ctx, 2, 'Delivering the artifact');

            // The theme is settled by now, so a name that matched nothing can
            // finally be reported. Without this the render silently falls back
            // and returns a file byte-identical to one the caller never asked
            // for — the description promises the opposite.
            const rendered = warnings.map(warningDiagnostic);
            const themeIssues = await themeDiagnostics(adapter, {
              ...(args.theme !== undefined && { requested: args.theme }),
              ...(themeLabel !== undefined && { resolved: themeLabel }),
              document: resolved.document,
              reported: rendered,
            });
            const collected = [...rendered, ...themeIssues];

            const mimeType = MIME_TYPES[adapter.extension];
            if (mimeType === undefined) {
              return {
                ...failure(
                  ERROR_CODES.INTERNAL,
                  `No MIME type registered for "${adapter.extension}".`
                ),
                ...base,
              };
            }
            const delivered = await deliverArtifact(buffer, {
              filename: args.filename ?? `${adapter.label}${adapter.extension}`,
              mimeType,
              ...(args.outputMode !== undefined && { mode: args.outputMode }),
              outputRoot: deps.outputRoot,
              maxInlineBytes: deps.maxInlineArtifactBytes,
            });
            if (!delivered.ok) {
              return {
                ...delivered,
                diagnostics: [...delivered.diagnostics, ...collected],
                ...base,
                source,
              };
            }

            await reportProgress(ctx, PROGRESS_TOTAL, 'Done');
            return {
              ok: true,
              diagnostics: collected,
              ...base,
              ...(args.renderer !== undefined && { renderer: args.renderer }),
              ...(themeLabel !== undefined && { theme: themeLabel }),
              artifact: delivered.artifact,
              source,
            };
          }),
          args.maxDiagnostics
        )
      )
  );
}
