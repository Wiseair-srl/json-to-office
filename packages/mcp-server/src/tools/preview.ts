/**
 * `jto_preview` — look at the document instead of reasoning about it.
 *
 * Layout questions are cheap to answer with pixels and expensive to answer
 * with inference: whether a table overflowed, whether a title wrapped, whether
 * a slide is crowded. This renders selected pages to PNG and hands them back
 * as image content blocks the model can actually see — or, when that would
 * cost more than a client should carry, as files under the output root.
 *
 * The renderer is LibreOffice, which is not Word and not PowerPoint. It is
 * close enough to answer "did this fit"; it is not the authority on how a
 * recipient's Office will paginate. The tool description says so, and so does
 * every result, because that caveat matters most at the moment someone is
 * looking at the picture.
 */

import type { McpServer, ServerContext } from '@modelcontextprotocol/server';

import type { ToolDeps } from '../lib/deps.js';
import {
  deliverArtifact,
  MIME_TYPES,
  type Artifact,
} from '../lib/artifacts.js';
import {
  condenseDiagnostics,
  maxDiagnosticsProperty,
  truncatedProperty,
} from '../lib/diagnostic-budget.js';
import { resolveDocumentSource, sourceSummary } from '../lib/doc-source.js';
import {
  diagnostic,
  failureFrom,
  guarded,
  success,
  toolResult,
  type Diagnostic,
  type Failure,
  type ToolEnvelope,
} from '../lib/errors.js';
import { checkGeneratedAt } from '../lib/render-options.js';
import {
  S,
  artifactSchema,
  documentSourceProperties,
  formatSchema,
  outputSchema,
  renderOptionProperties,
  sourceSummarySchema,
  type DocumentSourceInput,
  type RenderOptionsInput,
  type SourceSummary,
} from '../lib/schema.js';
import type { FormatName } from '../lib/adapters.js';
import { PREVIEW_ERROR_CODES } from '../preview/codes.js';
import {
  ALL_PAGES,
  PAGE_SPEC_PATTERN,
  formatPageSelection,
} from '../preview/page-spec.js';
import {
  MAX_INLINE_IMAGE_BYTES,
  MAX_INLINE_IMAGE_PAGES,
  MAX_PREVIEW_PAGES,
  MAX_TOTAL_INLINE_BYTES,
  PREVIEW_DEFAULT_DPI,
  PREVIEW_MAX_DPI,
  PREVIEW_MIN_DPI,
  budgetSuggestion,
  describeBudget,
  measuredInlineBudget,
  type InlineBudget,
  type PreviewOutputMode,
} from '../preview/limits.js';
import {
  renderPreview,
  type PreviewProgress,
  type PreviewRenderSuccess,
  type RenderedPage,
} from '../preview/render.js';

/**
 * The standing caveat, repeated in every result.
 *
 * A model that is looking at a rendered page is at exactly the moment it might
 * conclude something about how Word will lay the document out. This is the
 * sentence that stops it.
 */
export const PREVIEW_FIDELITY_NOTE =
  'Rendered by LibreOffice, not by Microsoft Office. Line breaks, pagination, font substitution and chart rasterization can differ from Word or PowerPoint on the recipient’s machine; treat this as a strong indication of layout, not as the final document.';

export interface PreviewToolInput
  extends DocumentSourceInput,
    RenderOptionsInput {
  format: FormatName;
  pages?: string;
  dpi?: number;
  outputMode?: PreviewOutputMode;
  filenamePrefix?: string;
  maxDiagnostics?: number;
}

/**
 * Bridge `renderPreview`'s progress to the client, when it asked for progress.
 *
 * A client that sent no token gets no notifications and no wasted frames.
 * Failures to notify are swallowed: a dropped progress frame must never turn a
 * finished render into a failed one.
 */
export function progressReporter(
  ctx: Pick<ServerContext, 'mcpReq'>
): ((update: PreviewProgress) => void) | undefined {
  const progressToken = ctx.mcpReq._meta?.progressToken;
  if (progressToken === undefined) return undefined;
  return (update) => {
    try {
      void ctx.mcpReq
        .notify({
          method: 'notifications/progress',
          params: {
            progressToken,
            progress: update.progress,
            total: update.total,
            message: update.message,
          },
        })
        .catch(() => {});
    } catch {
      /* a closed transport is not this render's problem */
    }
  };
}

/**
 * Images or files, and whether an oversized payload is fatal.
 *
 * Split out because the interesting case is expensive to reach through the
 * renderer: proving that `auto` falls back rather than refusing needs a
 * document big enough to break the budget, and this needs only a budget.
 */
export function chooseDelivery(
  mode: PreviewOutputMode,
  budget: InlineBudget
): { inline: boolean; refuse: boolean; fellBack: boolean } {
  if (mode === 'path') return { inline: false, refuse: false, fellBack: false };
  if (mode === 'images') {
    return { inline: budget.fits, refuse: !budget.fits, fellBack: false };
  }
  return { inline: budget.fits, refuse: false, fellBack: !budget.fits };
}

/** How one page came back. */
interface DeliveredPage {
  page: number;
  width: number;
  height: number;
  bytes: number;
  cached: boolean;
  delivery: 'image' | 'path';
  artifact?: Artifact;
}

function pageFilename(prefix: string, page: number): string {
  return `${prefix}-p${String(page).padStart(3, '0')}.png`;
}

const pageSchema = {
  type: 'object' as const,
  properties: {
    page: { type: 'integer' as const, description: '1-based page number.' },
    width: { type: 'integer' as const },
    height: { type: 'integer' as const },
    bytes: { type: 'integer' as const },
    cached: {
      type: 'boolean' as const,
      description: 'True when no converter ran for this page.',
    },
    delivery: { type: 'string' as const, enum: ['image', 'path'] },
    artifact: artifactSchema,
  },
  required: ['page', 'width', 'height', 'bytes', 'cached', 'delivery'],
  additionalProperties: false,
};

export function register(server: McpServer, deps: ToolDeps): void {
  server.registerTool(
    'jto_preview',
    {
      title: 'Preview pages',
      description: `Render a document to PNG pages and look at them. Use this whenever the question is visual — did the table overflow, did the title wrap, is the slide crowded — rather than reasoning about the JSON.

Pages are selected with printer syntax, 1-based and inclusive: "all" (default), "3", "2-5", "4-" (to the end), "-3" (from the start), or a comma-separated mix like "1-3,7". At most ${MAX_PREVIEW_PAGES} pages per call.

Delivery: outputMode "auto" (default) inlines the pages as images when they fit the client-safe budget (at most ${MAX_INLINE_IMAGE_PAGES} pages, ${Math.round(MAX_INLINE_IMAGE_BYTES / 1024 / 1024)} MB per page, ${Math.round(MAX_TOTAL_INLINE_BYTES / 1024 / 1024)} MB total) and otherwise writes PNG files under the server output root and returns their paths. "images" refuses rather than falling back; "path" always writes files. Image blocks follow the text block in page order and correspond to the entries of \`pages\` whose delivery is "image".

FIDELITY: ${PREVIEW_FIDELITY_NOTE}

Needs LibreOffice and poppler on the host (see jto_info.previewDependencies); when either is absent the call returns a structured error naming what to install, never a crash.`,
      annotations: { readOnlyHint: true, openWorldHint: false },
      inputSchema: S<PreviewToolInput>({
        type: 'object',
        properties: {
          format: formatSchema,
          ...documentSourceProperties,
          ...renderOptionProperties,
          pages: {
            type: 'string',
            description:
              'Pages to render, 1-based and inclusive: "all", "3", "2-5", "4-", "-3", or "1-3,7". Defaults to "all".',
            pattern: PAGE_SPEC_PATTERN,
            default: ALL_PAGES,
          },
          dpi: {
            type: 'integer',
            description: `Rendering resolution. ${PREVIEW_DEFAULT_DPI} is legible without being wasteful; higher costs bytes quadratically and usually forces path delivery.`,
            minimum: PREVIEW_MIN_DPI,
            maximum: PREVIEW_MAX_DPI,
            default: PREVIEW_DEFAULT_DPI,
          },
          outputMode: {
            type: 'string',
            enum: ['auto', 'images', 'path'],
            description:
              '`auto` (default) inlines images when they fit the budget and writes files otherwise. `images` refuses instead of falling back. `path` always writes files under the output root.',
            default: 'auto',
          },
          filenamePrefix: {
            type: 'string',
            description:
              'Base name for written PNGs, relative to the output root; each page becomes `<prefix>-pNNN.png`. Must not escape the root.',
          },
          maxDiagnostics: maxDiagnosticsProperty,
        },
        required: ['format'],
        additionalProperties: false,
      }),
      outputSchema: S(
        outputSchema(
          {
            format: formatSchema,
            source: sourceSummarySchema,
            totalPages: {
              type: 'integer',
              description: 'Pages in the whole rendered document.',
            },
            selection: {
              type: 'string',
              description:
                'Canonical spelling of what was rendered, e.g. "1-3,7".',
            },
            dpi: { type: 'integer' },
            delivery: {
              type: 'string',
              enum: ['images', 'paths'],
              description: 'How the pages below came back.',
            },
            pages: { type: 'array', items: pageSchema },
            renderer: {
              type: 'object',
              description:
                'What produced the pixels, and how far to trust them.',
              properties: {
                engine: { type: 'string' },
                libreoffice: { type: 'string' },
                pdftoppm: { type: 'string' },
                fidelity: { type: 'string' },
              },
              required: ['engine', 'fidelity'],
              additionalProperties: false,
            },
            cache: {
              type: 'object',
              properties: {
                key: {
                  type: 'string',
                  description:
                    'Identity of this whole request: document, options, assets, fonts, DPI, page selection and converter versions.',
                },
                documentKey: {
                  type: 'string',
                  description:
                    'Identity of the document at this DPI, selection-free. Two overlapping selections share pages under it.',
                },
                hits: { type: 'integer' },
                misses: { type: 'integer' },
                enabled: { type: 'boolean' },
              },
              required: ['key', 'documentKey', 'hits', 'misses', 'enabled'],
              additionalProperties: false,
            },
            timings: {
              type: 'object',
              properties: {
                generateMs: { type: 'integer' },
                convertMs: { type: 'integer' },
                rasterizeMs: { type: 'integer' },
              },
              required: ['generateMs', 'convertMs', 'rasterizeMs'],
              additionalProperties: false,
            },
            truncated: truncatedProperty,
          },
          // Nothing beyond the envelope is required: a structured refusal
          // carries `ok: false` and diagnostics and nothing else, and the SDK
          // validates `structuredContent` against this schema — listing the
          // success fields here would make every refusal unreportable.
          []
        )
      ),
    },
    async (args, ctx) => {
      const outcome = await guarded<Delivery | Failure>(async () => {
        const dateError = checkGeneratedAt(args.generatedAt);
        if (dateError) return dateError;

        const source = await resolveDocumentSource(args, deps.workspaces());
        if (!source.ok) return source;

        const onProgress = progressReporter(ctx);
        const rendered = await renderPreview({
          format: args.format,
          document: source.document,
          ...(args.pages !== undefined && { pages: args.pages }),
          ...(args.dpi !== undefined && { dpi: args.dpi }),
          render: pickRenderOptions(args),
          outputMode: args.outputMode ?? 'auto',
          getAdapter: deps.getAdapter,
          signal: ctx.mcpReq.signal,
          ...(onProgress && { onProgress }),
        });
        if (!rendered.ok) return rendered;

        return deliver(rendered, args, deps, sourceSummary(source));
      });

      // The budget applies to whichever channel answered. A sixty-paragraph
      // document with one wrong prop refuses with sixty near-identical
      // diagnostics, all of which teach the agent the same single fact.
      if (!('payload' in outcome)) {
        const capped = condenseDiagnostics(
          outcome.diagnostics,
          args.maxDiagnostics
        );
        return toolResult({
          ...outcome,
          diagnostics: capped.kept,
          truncated: capped.truncated,
        });
      }

      const capped = condenseDiagnostics(
        outcome.payload.diagnostics,
        args.maxDiagnostics
      );
      const payload = {
        ...outcome.payload,
        diagnostics: capped.kept,
        truncated: capped.truncated,
      };

      // Image bytes ride in content blocks and nowhere else: a client reading
      // both channels would otherwise hold every page twice, and the base64 of
      // a 150-DPI page is not something to put in structured output.
      return {
        content: [
          { type: 'text' as const, text: JSON.stringify(payload) },
          ...outcome.images.map((page) => ({
            type: 'image' as const,
            data: page.png.toString('base64'),
            mimeType: MIME_TYPES['.png'] as string,
          })),
        ],
        structuredContent: payload,
      };
    }
  );
}

function pickRenderOptions(args: PreviewToolInput): RenderOptionsInput {
  return {
    ...(args.renderer !== undefined && { renderer: args.renderer }),
    ...(args.theme !== undefined && { theme: args.theme }),
    ...(args.themePath !== undefined && { themePath: args.themePath }),
    ...(args.deterministic !== undefined && {
      deterministic: args.deterministic,
    }),
    ...(args.generatedAt !== undefined && { generatedAt: args.generatedAt }),
    ...(args.baseDir !== undefined && { baseDir: args.baseDir }),
  };
}

/**
 * Decide how the rendered pages come back, then produce them.
 *
 * The estimate already refused an impossible `images` request before anything
 * rendered; this is the second gate, on the bytes that actually exist. In
 * `auto` an over-budget payload is not a failure — it silently becomes files
 * and says so, because an agent that asked to see forty pages still wants the
 * forty pages, just not in its context window.
 */
/**
 * The success payload, mirroring the output schema.
 *
 * Written out rather than inferred so the schema and the type are edited
 * together: `structuredContent` is validated against the schema at runtime, so
 * a field that exists in one and not the other is a silent dropped result.
 */
export interface PreviewPayload extends ToolEnvelope {
  format: FormatName;
  source: SourceSummary;
  totalPages: number;
  selection: string;
  dpi: number;
  delivery: 'images' | 'paths';
  pages: DeliveredPage[];
  renderer: {
    engine: string;
    libreoffice?: string;
    pdftoppm?: string;
    fidelity: string;
  };
  cache: {
    key: string;
    documentKey: string;
    hits: number;
    misses: number;
    enabled: boolean;
  };
  timings: { generateMs: number; convertMs: number; rasterizeMs: number };
}

/** The two channels a successful preview answers on. */
interface Delivery {
  payload: PreviewPayload;
  /** Empty when the pages were written to disk. */
  images: RenderedPage[];
}

async function deliver(
  rendered: PreviewRenderSuccess,
  args: PreviewToolInput,
  deps: ToolDeps,
  source: SourceSummary
): Promise<Delivery | Failure> {
  const diagnostics: Diagnostic[] = [...rendered.diagnostics];
  const budget = measuredInlineBudget(rendered.pages.map((p) => p.png.length));
  const { inline, refuse, fellBack } = chooseDelivery(
    args.outputMode ?? 'auto',
    budget
  );

  if (refuse) {
    return failureFrom([
      ...diagnostics,
      diagnostic(PREVIEW_ERROR_CODES.TOO_LARGE, describeBudget(budget), {
        suggestion: budgetSuggestion(rendered.dpi),
        context: { budget, dpi: rendered.dpi },
      }),
    ]);
  }

  if (fellBack) {
    diagnostics.push(
      diagnostic(
        PREVIEW_ERROR_CODES.TOO_LARGE,
        `${describeBudget(budget)} Written to the output root instead.`,
        {
          severity: 'info',
          suggestion: budgetSuggestion(rendered.dpi),
          context: { budget },
        }
      )
    );
  }

  const prefix =
    args.filenamePrefix ?? `preview-${rendered.keys.runKey.slice(0, 12)}`;
  const pages: DeliveredPage[] = [];

  for (const page of rendered.pages) {
    const base = {
      page: page.page,
      width: page.width,
      height: page.height,
      bytes: page.png.length,
      cached: page.cached,
    };
    if (inline) {
      pages.push({ ...base, delivery: 'image' });
      continue;
    }
    const delivered = await deliverArtifact(page.png, {
      filename: pageFilename(prefix, page.page),
      mimeType: MIME_TYPES['.png'] as string,
      outputRoot: deps.outputRoot,
    });
    if (!delivered.ok)
      return failureFrom([...diagnostics, ...delivered.diagnostics]);
    pages.push({ ...base, delivery: 'path', artifact: delivered.artifact });
  }

  const payload: PreviewPayload = success(
    {
      format: rendered.format,
      source,
      totalPages: rendered.totalPages,
      selection: formatPageSelection(rendered.pages.map((p) => p.page)),
      dpi: rendered.dpi,
      delivery: (inline ? 'images' : 'paths') as 'images' | 'paths',
      pages,
      renderer: {
        engine: 'libreoffice',
        ...(rendered.converters.libreoffice !== undefined && {
          libreoffice: rendered.converters.libreoffice,
        }),
        ...(rendered.converters.pdftoppm !== undefined && {
          pdftoppm: rendered.converters.pdftoppm,
        }),
        fidelity: PREVIEW_FIDELITY_NOTE,
      },
      cache: {
        key: rendered.keys.runKey,
        documentKey: rendered.keys.documentKey,
        hits: rendered.cache.hits,
        misses: rendered.cache.misses,
        enabled: rendered.cache.enabled,
      },
      timings: rendered.timings,
    },
    diagnostics
  );

  return { payload, images: inline ? rendered.pages : [] };
}
