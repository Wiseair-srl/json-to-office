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
import { checkOutputName } from '../lib/output-root.js';
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
import {
  checkGeneratedAt,
  resolveThemePathOption,
} from '../lib/render-options.js';
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
import { checkRenderer, type FormatName } from '../lib/adapters.js';
import { PREVIEW_ERROR_CODES } from '../preview/codes.js';
import {
  ALL_PAGES,
  PAGE_SPEC_PATTERN,
  formatPageSelection,
} from '../preview/page-spec.js';
import {
  MAX_INLINE_IMAGE_BYTES,
  MAX_INLINE_IMAGE_PAGES,
  MAX_INLINE_SHEET_PIXELS,
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
} from '../preview/render.js';
import {
  ContactSheetError,
  buildContactSheet,
  type ContactSheet,
} from '../preview/contact-sheet.js';

/** Pages a contact sheet renders at: small on the page, many on the sheet. */
export const CONTACT_SHEET_DPI = 72;

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
  contactSheet?: boolean;
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
  delivery: 'image' | 'path' | 'sheet';
  artifact?: Artifact;
}

/** The composed sheet, as the payload reports it. */
interface DeliveredContactSheet {
  columns: number;
  rows: number;
  pageCount: number;
  width: number;
  height: number;
  bytes: number;
  delivery: 'image' | 'path';
  artifact?: Artifact;
}

function pageFilename(prefix: string, page: number): string {
  return `${prefix}-p${String(page).padStart(3, '0')}.png`;
}

function sheetFilename(prefix: string): string {
  return `${prefix}-sheet.png`;
}

const contactSheetSchema = {
  type: 'object' as const,
  description:
    'The composed sheet, when one was requested. Present whether it was inlined or written.',
  properties: {
    columns: { type: 'integer' as const },
    rows: { type: 'integer' as const },
    pageCount: {
      type: 'integer' as const,
      description: 'Pages tiled into the sheet.',
    },
    width: { type: 'integer' as const },
    height: { type: 'integer' as const },
    bytes: { type: 'integer' as const },
    delivery: { type: 'string' as const, enum: ['image', 'path'] },
    artifact: artifactSchema,
  },
  required: [
    'columns',
    'rows',
    'pageCount',
    'width',
    'height',
    'bytes',
    'delivery',
  ],
  additionalProperties: false,
};

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
    delivery: { type: 'string' as const, enum: ['image', 'path', 'sheet'] },
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

Set contactSheet: true to get one labelled image tiling every selected page instead of the pages themselves — the way to judge cross-page consistency (rhythm, alignment, chrome) in a single look. It renders at ${CONTACT_SHEET_DPI} DPI unless \`dpi\` says otherwise, inlines when the sheet fits one image block, and is written to the output root when it does not.

Delivery: outputMode "auto" (default) inlines the pages as images when they fit the client-safe budget (at most ${MAX_INLINE_IMAGE_PAGES} pages, ${Math.round(MAX_INLINE_IMAGE_BYTES / 1024 / 1024)} MB per page, ${Math.round(MAX_TOTAL_INLINE_BYTES / 1024 / 1024)} MB total) and otherwise writes PNG files under the server output root and returns their paths. "images" refuses rather than falling back; "path" always writes files. Image blocks follow the text block in page order and correspond to the entries of \`pages\` whose delivery is "image".

FIDELITY: ${PREVIEW_FIDELITY_NOTE}

Needs LibreOffice and poppler on the host (see jto_info.previewDependencies); when either is absent the call returns a structured error naming what to install, never a crash.`,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: true,
      },
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
          contactSheet: {
            type: 'boolean',
            description: `Return one labelled image tiling every selected page instead of the pages themselves. Cross-page consistency — rhythm, alignment, chrome — becomes a single look. Renders at ${CONTACT_SHEET_DPI} DPI unless \`dpi\` says otherwise, and falls back to a written file when the sheet outgrows the inline budget.`,
            default: false,
          },
          filenamePrefix: {
            type: 'string',
            description:
              'Base name for written PNGs, relative to the output root; each page becomes `<prefix>-pNNN.png`, and a contact sheet becomes `<prefix>-sheet.png`. Must not escape the root.',
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
              enum: ['images', 'paths', 'sheet'],
              description:
                'How the pages below came back. `sheet` means one contact sheet answered for all of them; whether it was inlined or written is on `contactSheet.delivery`.',
            },
            pages: { type: 'array', items: pageSchema },
            contactSheet: contactSheetSchema,
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

        const adapter = deps.getAdapter(args.format);
        const rendererError = await checkRenderer(adapter, args.renderer);
        if (rendererError) return rendererError;

        const themePath = resolveThemePathOption(args.themePath, args.baseDir);
        if (!themePath.ok) return themePath;

        if (args.filenamePrefix !== undefined) {
          const outputNameError =
            checkOutputName(pageFilename(args.filenamePrefix, 1)) ??
            checkOutputName(sheetFilename(args.filenamePrefix));
          if (outputNameError) return outputNameError;
        }

        const source = await resolveDocumentSource(args, deps.workspaces());
        if (!source.ok) return source;

        const onProgress = progressReporter(ctx);
        // A sheet renders small and never inlines the pages themselves, so
        // the per-page inline budget must not refuse a twenty-slide deck
        // before anything has been composed.
        const sheetRequested = args.contactSheet === true;
        const dpi =
          args.dpi ?? (sheetRequested ? CONTACT_SHEET_DPI : undefined);
        const rendered = await renderPreview({
          format: args.format,
          document: source.document,
          ...(args.pages !== undefined && { pages: args.pages }),
          ...(dpi !== undefined && { dpi }),
          render: pickRenderOptions(args, themePath.path),
          outputMode: sheetRequested ? 'path' : args.outputMode ?? 'auto',
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
          ...outcome.images.map((png) => ({
            type: 'image' as const,
            data: png.toString('base64'),
            mimeType: MIME_TYPES['.png'] as string,
          })),
        ],
        structuredContent: payload,
      };
    }
  );
}

function pickRenderOptions(
  args: PreviewToolInput,
  resolvedThemePath?: string
): RenderOptionsInput {
  return {
    ...(args.renderer !== undefined && { renderer: args.renderer }),
    ...(args.theme !== undefined && { theme: args.theme }),
    ...(resolvedThemePath !== undefined && { themePath: resolvedThemePath }),
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
  delivery: 'images' | 'paths' | 'sheet';
  pages: DeliveredPage[];
  contactSheet?: DeliveredContactSheet;
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
  /**
   * PNGs to inline, in the order the content blocks carry them. Empty when
   * everything was written to disk; exactly one entry for an inlined sheet.
   */
  images: Buffer[];
}

async function deliver(
  rendered: PreviewRenderSuccess,
  args: PreviewToolInput,
  deps: ToolDeps,
  source: SourceSummary
): Promise<Delivery | Failure> {
  const diagnostics: Diagnostic[] = [...rendered.diagnostics];
  const prefix =
    args.filenamePrefix ?? `preview-${rendered.keys.runKey.slice(0, 12)}`;

  if (args.contactSheet === true) {
    return deliverContactSheet(
      rendered,
      args,
      deps,
      source,
      diagnostics,
      prefix
    );
  }

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

  return { payload, images: inline ? rendered.pages.map((p) => p.png) : [] };
}

/** The fields every preview payload carries, sheet or pages. */
function previewEnvelope(
  rendered: PreviewRenderSuccess,
  source: SourceSummary
) {
  return {
    format: rendered.format,
    source,
    totalPages: rendered.totalPages,
    selection: formatPageSelection(rendered.pages.map((p) => p.page)),
    dpi: rendered.dpi,
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
  };
}

/**
 * Compose the pages into one image, then deliver that image.
 *
 * The budget question is different from the per-page one: there is a single
 * image, so only the single-image ceiling applies, and a sheet that breaks it
 * is written to the output root exactly as an over-budget page set is. The
 * pages themselves are never delivered — they are in the sheet — but they stay
 * listed so a caller can still see what was rendered and ask for one of them
 * at full size afterwards.
 */
async function deliverContactSheet(
  rendered: PreviewRenderSuccess,
  args: PreviewToolInput,
  deps: ToolDeps,
  source: SourceSummary,
  diagnostics: Diagnostic[],
  prefix: string
): Promise<Delivery | Failure> {
  let sheet: ContactSheet;
  try {
    sheet = buildContactSheet(rendered.pages);
  } catch (error) {
    if (!(error instanceof ContactSheetError)) throw error;
    return failureFrom([
      ...diagnostics,
      diagnostic(
        PREVIEW_ERROR_CODES.RENDER_FAILED,
        `The pages could not be composed into a contact sheet: ${error.message}`,
        {
          suggestion: 'Ask for the pages themselves with contactSheet omitted.',
          context: { pageCount: rendered.pages.length },
        }
      ),
    ]);
  }

  const pages: DeliveredPage[] = rendered.pages.map((page) => ({
    page: page.page,
    width: page.width,
    height: page.height,
    bytes: page.png.length,
    cached: page.cached,
    delivery: 'sheet' as const,
  }));

  const pixels = sheet.width * sheet.height;
  const oversized =
    sheet.png.length > MAX_INLINE_IMAGE_BYTES ||
    pixels > MAX_INLINE_SHEET_PIXELS;
  const fits = args.outputMode !== 'path' && !oversized;
  const overrun = `The contact sheet is ${Math.round(sheet.png.length / 1024)} KB and ${(pixels / 1_000_000).toFixed(1)} megapixels, past the ${Math.round(MAX_INLINE_IMAGE_BYTES / 1024 / 1024)} MB / ${MAX_INLINE_SHEET_PIXELS / 1_000_000} MP ceiling for one inlined image.`;
  const base = {
    columns: sheet.columns,
    rows: sheet.rows,
    pageCount: sheet.pageCount,
    width: sheet.width,
    height: sheet.height,
    bytes: sheet.png.length,
  };

  if (args.outputMode === 'images' && !fits) {
    return failureFrom([
      ...diagnostics,
      diagnostic(PREVIEW_ERROR_CODES.TOO_LARGE, overrun, {
        suggestion:
          'Narrow `pages` or drop `outputMode: "images"` to have the sheet written to the output root.',
        context: {
          bytes: sheet.png.length,
          pixels,
          pageCount: sheet.pageCount,
        },
      }),
    ]);
  }

  if (fits) {
    const payload: PreviewPayload = success(
      {
        ...previewEnvelope(rendered, source),
        delivery: 'sheet' as const,
        pages,
        contactSheet: { ...base, delivery: 'image' as const },
      },
      diagnostics
    );
    return { payload, images: [sheet.png] };
  }

  if (args.outputMode !== 'path') {
    diagnostics.push(
      diagnostic(
        PREVIEW_ERROR_CODES.TOO_LARGE,
        `${overrun} Written to the output root instead.`,
        {
          severity: 'info',
          suggestion:
            'Narrow `pages` for a sheet that inlines, or open the written file.',
          context: {
            bytes: sheet.png.length,
            pixels,
            pageCount: sheet.pageCount,
          },
        }
      )
    );
  }

  const delivered = await deliverArtifact(sheet.png, {
    filename: sheetFilename(prefix),
    mimeType: MIME_TYPES['.png'] as string,
    outputRoot: deps.outputRoot,
  });
  if (!delivered.ok)
    return failureFrom([...diagnostics, ...delivered.diagnostics]);

  const payload: PreviewPayload = success(
    {
      ...previewEnvelope(rendered, source),
      delivery: 'sheet' as const,
      pages,
      contactSheet: {
        ...base,
        delivery: 'path' as const,
        artifact: delivered.artifact,
      },
    },
    diagnostics
  );
  return { payload, images: [] };
}
