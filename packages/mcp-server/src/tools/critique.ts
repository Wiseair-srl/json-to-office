/**
 * `jto_critique` — the review step, made part of the product (#345).
 *
 * Everything else this server does is deterministic: a rule either fires or it
 * does not. Whether a document is worth sending is not that kind of question,
 * and the only judge available is the model already in the conversation. So
 * the tool does not judge. It renders the exact revision the agent asks about,
 * puts readable evidence and the rubric in front of it — a contact sheet for
 * the whole document, full-resolution pages where the rendered pass found
 * something — and hands back a run id.
 *
 * `record` is where the round happens. It takes that run id and the verdict
 * formed against it, and it is the only thing that increments the count. That
 * separation is the point: inspecting twice, or a dropped response retried, is
 * not a second opinion, and a verdict about a revision the workspace has since
 * moved past is refused rather than filed against a document nobody saw.
 *
 * Three recorded iterations is the limit. The fourth answer is not a refusal —
 * the agent may still patch whatever it likes — but a recommendation to stop
 * revising and either ship or change the plan, because past three rounds
 * subjective polish stops converging.
 */

import type { McpServer, ServerContext } from '@modelcontextprotocol/server';
import { RUBRIC, SHIPPING_QUESTION } from '@json-to-office/shared';

import { checkRenderer, type FormatName } from '../lib/adapters.js';
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
import type { ToolDeps } from '../lib/deps.js';
import {
  MAX_CRITIQUE_ROUNDS,
  type CritiqueRecord,
  type CritiqueVerdict,
} from '../lib/critique-log.js';
import {
  ERROR_CODES,
  diagnostic,
  failure,
  guarded,
  success,
  toolResult,
  type Diagnostic,
  type Failure,
  type ToolEnvelope,
} from '../lib/errors.js';
import {
  S,
  artifactSchema,
  formatSchema,
  outputSchema,
} from '../lib/schema.js';
import {
  ContactSheetError,
  buildContactSheet,
  contactSheetFitsInline,
  contactSheetShape,
  type ContactSheetShape,
} from '../preview/contact-sheet.js';
import { PREVIEW_ERROR_CODES } from '../preview/codes.js';
import {
  MAX_INLINE_IMAGE_BYTES,
  MAX_TOTAL_INLINE_BYTES,
  PREVIEW_DEFAULT_DPI,
} from '../preview/limits.js';
import { collectRenderedFindings } from '../preview/rendered-findings.js';
import { renderPreview } from '../preview/render.js';
import { progressReporter, PREVIEW_FIDELITY_NOTE } from './preview.js';

/** Full-resolution pages `inspect` inlines beside the sheet, at most. */
export const MAX_EVIDENCE_PAGES = 4;

export interface CritiqueInput {
  action: 'inspect' | 'record';
  handle: string;
  format?: FormatName;
  revision?: number;
  evidencePages?: number;
  runId?: string;
  verdict?: CritiqueVerdict;
  rationale?: string;
  level?: number;
  maxDiagnostics?: number;
}

/** A page put in front of the model, and why that page. */
interface Evidence {
  page: number;
  /** What the rendered pass found there, or why it was chosen anyway. */
  reason: string;
  findings: number;
  delivery: 'image' | 'path';
  artifact?: Artifact;
}

/**
 * The two channels a tool answers on: the structured payload, and the PNGs
 * that ride in image content blocks beside it. `jto_preview` answers the same
 * way; images never go through structured output, where a client reading both
 * would hold every page twice.
 */
interface Delivery {
  payload: ToolEnvelope;
  images: Buffer[];
}

const rubricSchema = {
  type: 'object' as const,
  description:
    'What "good" means, as data: the five levels in order, and the question the programme’s target is actually stated against. A higher level never compensates for a failure below it — judge the highest level whose bar is met and whose every lower bar is met.',
  properties: {
    levels: {
      type: 'array' as const,
      items: {
        type: 'object' as const,
        properties: {
          level: { type: 'integer' as const },
          name: { type: 'string' as const },
          bar: { type: 'string' as const },
        },
        required: ['level', 'name', 'bar'],
        additionalProperties: false,
      },
    },
    shippingQuestion: { type: 'string' as const },
  },
  required: ['levels', 'shippingQuestion'],
  additionalProperties: false,
};

const runSchema = {
  type: 'object' as const,
  description:
    'The inspection this evidence belongs to. Pass `id` back to `record` with the verdict it produced.',
  properties: {
    id: { type: 'string' as const },
    handle: { type: 'string' as const },
    revision: {
      type: 'integer' as const,
      description:
        'The revision the evidence was rendered from. A record is refused once the workspace has moved past it.',
    },
    round: {
      type: 'integer' as const,
      description:
        'Recorded iterate verdicts against this workspace so far. Inspecting does not change it.',
    },
    roundsRemaining: { type: 'integer' as const },
  },
  required: ['id', 'handle', 'revision', 'round', 'roundsRemaining'],
  additionalProperties: false,
};

export function register(server: McpServer, deps: ToolDeps): void {
  server.registerTool(
    'jto_critique',
    {
      title: 'Inspect a draft, then record the verdict',
      description: `Review a workspace document the way a person would, and keep the score honestly.

\`action: "inspect"\` renders the workspace at its current revision (or the \`revision\` you name), and returns: one contact sheet tiling every page, up to ${MAX_EVIDENCE_PAGES} full-resolution pages chosen where the rendered pass found something, that pass's findings as diagnostics with certainty "rendered", the rubric as data, and a run id. Look at the images — that is the point of the call — and judge the document against the rubric's five levels and its shipping question.

\`action: "record"\` files that judgement: the \`runId\` you were given, \`verdict\` "ship" or "iterate", and a \`rationale\` naming the page and the element that decided it. Only recording counts as a round. Inspecting twice does not, and re-sending the same \`runId\` after a dropped response returns the round already filed rather than a second one. A verdict is about the revision it was formed against, so a record is refused once the workspace has moved past that revision — inspect again and judge what is there now.

${MAX_CRITIQUE_ROUNDS} recorded iterate rounds is the limit; the third answers with a stop recommendation, because past three rounds subjective polish stops converging. Nothing here blocks jto_generate.

Needs LibreOffice and poppler on the host (see jto_info.previewDependencies). FIDELITY: ${PREVIEW_FIDELITY_NOTE}`,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: true,
      },
      inputSchema: S<CritiqueInput>({
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['inspect', 'record'],
            description:
              '`inspect` renders and returns evidence and a run id; `record` files the verdict formed against one.',
          },
          handle: {
            type: 'string',
            minLength: 1,
            description:
              'The workspace being reviewed. Critique is keyed to a workspace revision, so an inline document cannot be critiqued — open one with jto_scaffold or jto_workspace_create.',
          },
          format: {
            ...formatSchema,
            description: 'The workspace’s own when omitted.',
          },
          revision: {
            type: 'integer',
            minimum: 1,
            description:
              'inspect: the revision to render, current when omitted. record: the revision judged, checked against the run’s.',
          },
          evidencePages: {
            type: 'integer',
            minimum: 0,
            maximum: MAX_EVIDENCE_PAGES,
            description: `inspect: full-resolution pages to inline beside the sheet. Defaults to ${MAX_EVIDENCE_PAGES}; 0 returns the sheet alone. Every page is written to the output root either way.`,
          },
          runId: {
            type: 'string',
            description: 'record: the run id the inspection returned.',
          },
          verdict: {
            type: 'string',
            enum: ['ship', 'iterate'],
            description:
              'record: whether you would send this document as it stands.',
          },
          rationale: {
            type: 'string',
            minLength: 1,
            description:
              'record: two or three sentences naming the page and the element that decided it, not "the layout".',
          },
          level: {
            type: 'integer',
            minimum: 1,
            maximum: 5,
            description:
              'record: the highest rubric level met, with every level below it met. Optional.',
          },
          maxDiagnostics: maxDiagnosticsProperty,
        },
        required: ['action', 'handle'],
        additionalProperties: false,
      }),
      outputSchema: S(
        outputSchema(
          {
            action: { type: 'string', enum: ['inspect', 'record'] },
            run: runSchema,
            rubric: rubricSchema,
            format: formatSchema,
            totalPages: { type: 'integer' },
            dpi: { type: 'integer' },
            contactSheet: {
              type: 'object',
              description:
                'The sheet tiling every page, inlined as the first image when it fits one block and written to the output root otherwise.',
              properties: {
                columns: { type: 'integer' },
                rows: { type: 'integer' },
                pageCount: { type: 'integer' },
                width: { type: 'integer' },
                height: { type: 'integer' },
                bytes: { type: 'integer' },
                delivery: { type: 'string', enum: ['image', 'path'] },
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
            },
            evidence: {
              type: 'array',
              description:
                'The pages worth a closer look, in the order the image blocks carry them: those the rendered pass named, then the first pages. Every one is on disk; `delivery` says whether it is also inline.',
              items: {
                type: 'object',
                properties: {
                  page: { type: 'integer' },
                  reason: { type: 'string' },
                  findings: { type: 'integer' },
                  delivery: { type: 'string', enum: ['image', 'path'] },
                  artifact: artifactSchema,
                },
                required: ['page', 'reason', 'findings', 'delivery'],
                additionalProperties: false,
              },
            },
            record: {
              type: 'object',
              description: 'The round as filed.',
              properties: {
                runId: { type: 'string' },
                handle: { type: 'string' },
                revision: { type: 'integer' },
                verdict: { type: 'string', enum: ['ship', 'iterate'] },
                rationale: { type: 'string' },
                level: { type: 'integer' },
                recordedAt: { type: 'string' },
              },
              required: [
                'runId',
                'handle',
                'revision',
                'verdict',
                'rationale',
                'recordedAt',
              ],
              additionalProperties: false,
            },
            rounds: {
              type: 'integer',
              description: 'Recorded iterate verdicts against this workspace.',
            },
            roundsRemaining: { type: 'integer' },
            stop: {
              type: 'boolean',
              description:
                'True once the verdict was to ship, or the rounds are spent. Advice, not a gate: nothing here refuses a later patch or generation.',
            },
            renderer: {
              type: 'object',
              properties: {
                engine: { type: 'string' },
                fidelity: { type: 'string' },
              },
              required: ['engine', 'fidelity'],
              additionalProperties: false,
            },
            truncated: truncatedProperty,
          },
          []
        )
      ),
    },
    async (args, ctx) => {
      const outcome = await guarded<Delivery | Failure>(async () =>
        args.action === 'record'
          ? await recordVerdict(args, deps)
          : await inspect(args, deps, ctx)
      );
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

const RUBRIC_DATA = {
  levels: RUBRIC.map((entry) => ({
    level: entry.level,
    name: entry.name,
    bar: entry.bar,
  })),
  shippingQuestion: SHIPPING_QUESTION,
};

/**
 * Render the revision and put the evidence in front of the model.
 *
 * One render, at the readable DPI: the contact sheet is composed from those
 * pages downscaled, so judging the whole document and reading one page of it
 * cost one conversion rather than two. Every page is written under the output
 * root whatever the inline budget allows, so the evidence is always reachable.
 */
async function inspect(
  args: CritiqueInput,
  deps: ToolDeps,
  ctx: Pick<ServerContext, 'mcpReq'>
): Promise<Delivery | Failure> {
  const opened = await deps.workspaces().get(args.handle, {
    ...(args.revision !== undefined && { revision: args.revision }),
  });
  if (!opened.ok) return opened;
  const format = args.format ?? opened.record.format;
  const adapter = deps.getAdapter(format);
  const rendererError = await checkRenderer(adapter, undefined);
  if (rendererError) return rendererError;

  const onProgress = progressReporter(ctx);
  const rendered = await renderPreview({
    format,
    document: opened.document,
    dpi: PREVIEW_DEFAULT_DPI,
    render: {},
    outputMode: 'path',
    rendered: true,
    getAdapter: deps.getAdapter,
    signal: ctx.mcpReq.signal,
    ...(onProgress && { onProgress }),
  });
  if (!rendered.ok) return rendered;

  const diagnostics: Diagnostic[] = [...rendered.diagnostics];
  const findings = rendered.rendered
    ? await collectRenderedFindings({
        format,
        document: opened.document,
        render: {},
        rendered: rendered.rendered,
        ...(rendered.prepared && { prepared: rendered.prepared }),
        adapter,
      })
    : { diagnostics: [] as Diagnostic[], summary: undefined };
  diagnostics.push(...findings.diagnostics);

  let sheetPng: Buffer | undefined;
  let sheetShape: ContactSheetShape | undefined;
  try {
    const sheet = buildContactSheet(rendered.pages);
    sheetPng = sheet.png;
    sheetShape = contactSheetShape(sheet);
  } catch (error) {
    if (!(error instanceof ContactSheetError)) throw error;
    diagnostics.push(
      diagnostic(
        PREVIEW_ERROR_CODES.RENDER_FAILED,
        `The pages could not be composed into a contact sheet: ${error.message}. The full-resolution pages below are the whole evidence.`,
        { severity: 'warning', context: { pageCount: rendered.pages.length } }
      )
    );
  }

  const prefix = `critique-${rendered.keys.runKey.slice(0, 12)}`;
  const images: Buffer[] = [];
  let contactSheet:
    | (ContactSheetShape & { delivery: 'image' | 'path'; artifact?: Artifact })
    | undefined;
  if (sheetPng && sheetShape) {
    if (contactSheetFitsInline(sheetShape)) {
      images.push(sheetPng);
      contactSheet = { ...sheetShape, delivery: 'image' };
    } else {
      const delivered = await deliverArtifact(sheetPng, {
        filename: `${prefix}-sheet.png`,
        mimeType: MIME_TYPES['.png'] as string,
        outputRoot: deps.outputRoot,
      });
      if (!delivered.ok)
        return {
          ...delivered,
          diagnostics: [...diagnostics, ...delivered.diagnostics],
        };
      contactSheet = {
        ...sheetShape,
        delivery: 'path',
        artifact: delivered.artifact,
      };
      diagnostics.push(
        diagnostic(
          PREVIEW_ERROR_CODES.TOO_LARGE,
          'The contact sheet is past the ceiling for one inlined image; it was written to the output root. Open it to judge the document as a whole.',
          { severity: 'info', context: { bytes: sheetShape.bytes } }
        )
      );
    }
  }

  const wanted = args.evidencePages ?? MAX_EVIDENCE_PAGES;
  const chosen = choosePages(
    rendered.pages.map((page) => page.page),
    findings.diagnostics,
    wanted
  );
  const evidence: Evidence[] = [];
  let inlined = images.reduce((total, png) => total + png.length, 0);
  for (const { page, reason, findings: count } of chosen) {
    const png = rendered.pages.find((candidate) => candidate.page === page);
    if (!png) continue;
    const delivered = await deliverArtifact(png.png, {
      filename: `${prefix}-p${String(page).padStart(3, '0')}.png`,
      mimeType: MIME_TYPES['.png'] as string,
      outputRoot: deps.outputRoot,
    });
    if (!delivered.ok)
      return {
        ...delivered,
        diagnostics: [...diagnostics, ...delivered.diagnostics],
      };
    // The sheet has already spent part of the client's budget, so a page is
    // inlined only while the whole payload still fits it; the rest are on
    // disk, which is where all of them are anyway.
    const inline =
      png.png.length <= MAX_INLINE_IMAGE_BYTES &&
      inlined + png.png.length <= MAX_TOTAL_INLINE_BYTES;
    if (inline) {
      images.push(png.png);
      inlined += png.png.length;
    }
    evidence.push({
      page,
      reason,
      findings: count,
      delivery: inline ? 'image' : 'path',
      artifact: delivered.artifact,
    });
  }

  const rounds = deps.critiques.rounds(args.handle).length;
  const run = deps.critiques.open({
    handle: args.handle,
    format,
    revision: opened.record.revision,
  });
  diagnostics.push(
    diagnostic(
      ERROR_CODES.CRITIQUE_STOP,
      rounds >= MAX_CRITIQUE_ROUNDS
        ? `${rounds} iterate rounds are already recorded for this workspace; judge it, but expect the record to recommend stopping.`
        : `Look at the images, judge them against the rubric, then call jto_critique record with runId "${run.id}". Only that counts as a round; ${MAX_CRITIQUE_ROUNDS - rounds} remain.`,
      {
        severity: 'info',
        context: { runId: run.id, rounds, revision: opened.record.revision },
      }
    )
  );

  return {
    payload: success(
      {
        action: 'inspect' as const,
        run: {
          id: run.id,
          handle: run.handle,
          revision: run.revision,
          round: rounds,
          roundsRemaining: Math.max(0, MAX_CRITIQUE_ROUNDS - rounds),
        },
        rubric: RUBRIC_DATA,
        format,
        totalPages: rendered.totalPages,
        dpi: rendered.dpi,
        ...(contactSheet && { contactSheet }),
        evidence,
        ...(findings.summary && { rendered: findings.summary }),
        renderer: { engine: 'libreoffice', fidelity: PREVIEW_FIDELITY_NOTE },
      },
      diagnostics
    ),
    images,
  };
}

/**
 * The pages worth a full-resolution look: the ones the rendered pass named,
 * worst first, then the document's own opening pages — because a cover that
 * breaks no rule can still be the reason a document is not sendable.
 */
export function choosePages(
  pages: readonly number[],
  findings: readonly Diagnostic[],
  wanted: number
): Array<{ page: number; reason: string; findings: number }> {
  const counts = new Map<number, number>();
  for (const finding of findings) {
    const page = (finding.context as { page?: unknown } | undefined)?.page;
    if (typeof page === 'number') counts.set(page, (counts.get(page) ?? 0) + 1);
  }
  const flagged = [...counts.entries()]
    .filter(([page]) => pages.includes(page))
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .map(([page, count]) => ({
      page,
      findings: count,
      reason: `${count} rendered finding${count === 1 ? '' : 's'} on this page.`,
    }));
  const rest = pages
    .filter((page) => !counts.has(page))
    .map((page) => ({
      page,
      findings: 0,
      reason: 'No rendered finding here; read it for what a rule cannot see.',
    }));
  return [...flagged, ...rest].slice(0, Math.max(0, wanted));
}

/**
 * File a verdict against the run that produced it.
 *
 * Everything here is about making the round count mean something: a run this
 * connection never opened, a run belonging to another workspace, a revision
 * the run did not inspect, and a workspace that has moved on since are all
 * refused; the same run recorded twice is the round already filed.
 */
async function recordVerdict(
  args: CritiqueInput,
  deps: ToolDeps
): Promise<Delivery | Failure> {
  if (args.runId === undefined || args.verdict === undefined || !args.rationale)
    return failure(
      ERROR_CODES.REQUIRED_PROPERTY,
      'record needs the runId an inspection returned, a verdict of "ship" or "iterate", and a rationale.',
      {
        suggestion:
          'Call jto_critique with action "inspect" first, look at the evidence, then record the verdict it produced.',
      }
    );

  const run = deps.critiques.run(args.runId);
  if (!run || run.handle !== args.handle)
    return failure(
      ERROR_CODES.CRITIQUE_RUN_UNKNOWN,
      run
        ? `Run "${args.runId}" inspected workspace ${run.handle}, not ${args.handle}.`
        : `This connection has no critique run "${args.runId}". Runs live only as long as the connection that opened them.`,
      {
        suggestion:
          'Inspect again and record against the run id that inspection returns.',
        context: { runId: args.runId, handle: args.handle },
      }
    );

  if (args.revision !== undefined && args.revision !== run.revision)
    return failure(
      ERROR_CODES.STALE_REVISION,
      `Run "${run.id}" inspected revision ${run.revision}, and the verdict names revision ${args.revision}.`,
      {
        suggestion:
          'Record the revision the run inspected, or inspect the revision you mean to judge.',
        context: { runRevision: run.revision, named: args.revision },
      }
    );

  const opened = await deps.workspaces().get(args.handle);
  if (!opened.ok) return opened;
  const already = deps.critiques.recordFor(run.id);
  if (!already && opened.record.revision !== run.revision)
    return failure(
      ERROR_CODES.STALE_REVISION,
      `The verdict was formed against revision ${run.revision} and this workspace is at ${opened.record.revision}; a round is only meaningful about the document that was seen.`,
      {
        suggestion:
          'Inspect again to judge what is there now, then record against that run.',
        context: {
          runRevision: run.revision,
          currentRevision: opened.record.revision,
        },
      }
    );

  const filed = deps.critiques.record({
    runId: run.id,
    handle: run.handle,
    revision: run.revision,
    verdict: args.verdict,
    rationale: args.rationale,
    ...(args.level !== undefined && { level: args.level }),
  });
  const rounds = deps.critiques.rounds(args.handle).length;
  const remaining = Math.max(0, MAX_CRITIQUE_ROUNDS - rounds);
  const stop = filed.record.verdict === 'ship' || remaining === 0;

  const diagnostics: Diagnostic[] = [];
  if (filed.duplicate)
    diagnostics.push(
      diagnostic(
        ERROR_CODES.CRITIQUE_DUPLICATE,
        `Run "${run.id}" already carries a "${filed.record.verdict}" verdict recorded at ${filed.record.recordedAt}; this call changed nothing and did not count as a round.`,
        {
          severity: 'info',
          context: { runId: run.id, rounds },
        }
      )
    );
  diagnostics.push(stopNote(filed.record, rounds, remaining, stop));

  return {
    payload: success(
      {
        action: 'record' as const,
        record: filed.record,
        run: {
          id: run.id,
          handle: run.handle,
          revision: run.revision,
          round: rounds,
          roundsRemaining: remaining,
        },
        rounds,
        roundsRemaining: remaining,
        stop,
      },
      diagnostics
    ),
    images: [],
  };
}

/**
 * What to do next, as the agent should read it: ship it, spend another round,
 * or stop revising because three rounds is where subjective polish stops
 * converging. Advice — nothing here refuses a later patch or generation.
 */
function stopNote(
  record: CritiqueRecord,
  rounds: number,
  remaining: number,
  stop: boolean
): Diagnostic {
  if (record.verdict === 'ship')
    return diagnostic(
      ERROR_CODES.CRITIQUE_STOP,
      'Recorded as sendable. Generate it; further subjective revision is not what this document needs.',
      { severity: 'info', context: { rounds, stop } }
    );
  if (remaining === 0)
    return diagnostic(
      ERROR_CODES.CRITIQUE_STOP,
      `${rounds} iterate rounds are recorded, which is the limit. Past three rounds subjective polish stops converging: repair whatever jto_validate still reports, then either ship it or change the structure — a fourth pass over the same layout will not decide it.`,
      { severity: 'warning', context: { rounds, stop } }
    );
  return diagnostic(
    ERROR_CODES.CRITIQUE_STOP,
    `Round ${rounds} of ${MAX_CRITIQUE_ROUNDS} recorded. Patch what the rationale names, then inspect again.`,
    { severity: 'info', context: { rounds, stop } }
  );
}
