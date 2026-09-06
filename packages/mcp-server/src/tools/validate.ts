/**
 * `jto_validate` — will this document render, and if not, where is it broken?
 * And when it renders: will it look right? The cores' quality analyzers
 * (#216) answer the second question in the same pass, as `W_QUALITY_*`
 * warnings and infos; an explicit run policy may move the gate.
 *
 * A document defect is never a protocol error and never `isError`: the whole
 * point of the tool is to hand an agent a list of places to repair, which a
 * JSON-RPC failure cannot carry. So every answer is a normal result, and the
 * only thing a caller branches on is `ok`.
 *
 * The validation plumbing this shares with `jto_generate` and `jto_docx_diff`
 * — the JSON Pointer mapping, the thrown-error adapter, the renderer check —
 * lives in `lib/`, so all three describe the same broken document the same way
 * without one tool module importing another.
 */

import type { McpServer } from '@modelcontextprotocol/server';
import type {
  QualityAnalysis,
  QualityPolicy,
  QualityProfile,
} from '@json-to-office/quality';

import {
  checkRenderer,
  rendererAvailability,
  withRenderer,
  type FormatName,
} from '../lib/adapters.js';
import type { ToolDeps } from '../lib/deps.js';
import { resolveDocumentSource, sourceSummary } from '../lib/doc-source.js';
import { scaffoldMarkerOccurrences } from '../lib/scaffold-markers.js';
import {
  ERROR_CODES,
  countDiagnostics,
  diagnostic,
  guarded,
  qualityAnalysisDiagnostics,
  qualityOptionDiagnostic,
  toolResult,
  validationDiagnostics,
  type Diagnostic,
} from '../lib/errors.js';
import {
  S,
  documentSourceProperties,
  formatSchema,
  outputSchema,
  renderOptionProperties,
  sourceSummarySchema,
  type DocumentSourceInput,
} from '../lib/schema.js';

const SEVERITY_RANK: Record<Diagnostic['severity'], number> = {
  error: 0,
  warning: 1,
  info: 2,
};

/**
 * Cap the list without losing the fatal entries.
 *
 * A document with a hundred style warnings and one structural error would
 * otherwise report the warnings and drop the only thing that stops it
 * rendering. Sorting by severity is stable, so document order survives within
 * each band.
 */
function capDiagnostics(
  diagnostics: Diagnostic[],
  limit: number
): { kept: Diagnostic[]; truncated: boolean } {
  if (diagnostics.length <= limit)
    return { kept: diagnostics, truncated: false };
  const ordered = [...diagnostics].sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      Number(b.blocking === true) - Number(a.blocking === true)
  );
  return { kept: ordered.slice(0, limit), truncated: true };
}

/**
 * A rule that threw is a hole in the report, not a clean bill of health.
 *
 * The engine's default `onRuleError: 'continue'` records the failure and
 * carries on, so the entire class of findings that rule owns disappears from
 * the answer — and an agent handed `ok: true` with an empty list reads that as
 * "nothing to fix" rather than "nobody looked".
 */
function ruleErrorDiagnostics(analysis: QualityAnalysis): Diagnostic[] {
  return analysis.ruleErrors.map((entry) =>
    diagnostic(
      ERROR_CODES.QUALITY_RULE_ERROR,
      `Quality rule "${entry.ruleId}" failed: ${entry.message}`,
      { severity: 'warning', source: 'quality', ruleId: entry.ruleId }
    )
  );
}

const DEFAULT_MAX_DIAGNOSTICS = 100;

interface ValidateArgs extends DocumentSourceInput {
  format: FormatName;
  renderer?: string;
  maxDiagnostics?: number;
  quality?: { profile?: QualityProfile; policy?: QualityPolicy };
  includeCompiled?: boolean;
}

/** What `PreparedDocument.metadata.blocks` carries when a format expands blocks. */
interface CompiledBlocks {
  document: unknown;
  sourceMap: Record<string, string>;
  blocks: readonly string[];
}

export function register(server: McpServer, deps: ToolDeps): void {
  server.registerTool(
    'jto_validate',
    {
      title: 'Validate a document',
      description:
        'Check a document against its format schema and report every defect as a path-addressed diagnostic. Paths are RFC 6901 JSON Pointers into the document you passed, so they can be used directly as patch targets; codes are the stable `E_`/`W_` vocabulary. `ok` mirrors generation: schema and semantic errors block; design-quality `W_QUALITY_*` findings advise by default and block only when `quality.policy.gate` requests it. A broken document is a normal result with `ok: false`, never a protocol error. `includeCompiled` returns the compiled form — every block (`document-local JSON blocks`, …) lowered in place to the primitives the renderer draws — with a source map from compiled pointers back to the authored slots.',
      annotations: { readOnlyHint: true, openWorldHint: false },
      inputSchema: S<ValidateArgs>({
        type: 'object',
        properties: {
          format: formatSchema,
          ...documentSourceProperties,
          renderer: {
            ...renderOptionProperties.renderer,
            description:
              "Renderer profile to validate against. Overrides the document's own `renderer` for this check only; omit to validate the document exactly as written.",
          },
          maxDiagnostics: {
            type: 'integer',
            minimum: 1,
            maximum: 1000,
            description: `Cap on returned diagnostics (default ${DEFAULT_MAX_DIAGNOSTICS}). Errors are kept ahead of warnings when the cap bites.`,
          },
          includeCompiled: {
            type: 'boolean',
            description:
              'Also return `compiled`: the document with every block lowered in place, the authored pointers of those blocks, and a source map from each compiled pointer to the slot it came from. Diagnostics already point at authored slots; this is for inspecting what a block became.',
          },
          quality: {
            type: 'object',
            description:
              'Optional design profile plus per-run enforcement policy.',
            properties: {
              profile: {
                type: 'object',
                properties: { id: { type: 'string', minLength: 1 } },
                required: ['id'],
                additionalProperties: true,
              },
              policy: {
                type: 'object',
                properties: {
                  gate: {
                    type: 'string',
                    enum: ['none', 'error', 'warning', 'info'],
                  },
                },
                additionalProperties: true,
              },
            },
            additionalProperties: false,
          },
        },
        required: ['format'],
        additionalProperties: false,
      }),
      outputSchema: S(
        outputSchema({
          format: formatSchema,
          renderer: {
            type: 'string',
            description: 'The profile the document was validated against.',
          },
          valid: {
            type: 'boolean',
            description:
              'True when nothing blocks generation. Equal to `ok` whenever validation actually ran.',
          },
          generationReady: {
            type: 'boolean',
            description:
              'True when `valid` and no `{{…}}` scaffold marker remains — the state jto_generate accepts. A draft from jto_scaffold is `valid` and not yet ready.',
          },
          scaffoldMarkers: {
            type: 'integer',
            description:
              'Scaffold markers still in the document; each is also reported as a W_QUALITY_SCAFFOLD_MARKER finding.',
          },
          source: sourceSummarySchema,
          counts: {
            type: 'object',
            description: 'Diagnostics by severity, before any cap.',
            properties: {
              error: { type: 'integer' },
              warning: { type: 'integer' },
              info: { type: 'integer' },
            },
            required: ['error', 'warning', 'info'],
            additionalProperties: false,
          },
          truncated: {
            type: 'boolean',
            description:
              '`diagnostics` was capped, by `maxDiagnostics` or by the budget the quality policy set.',
          },
          profileId: {
            type: 'string',
            description:
              'The quality profile the design analysis ran under, when one applied.',
          },
          compiled: {
            type: 'object',
            description:
              'Present with `includeCompiled`: the compiled form and its source map.',
            properties: {
              document: {
                description:
                  'The document with every block lowered in place; identical to the input when it holds no block.',
              },
              blocks: {
                type: 'array',
                items: { type: 'string' },
                description:
                  'Authored pointers of the blocks that were lowered.',
              },
              sourceMap: {
                type: 'object',
                additionalProperties: { type: 'string' },
                description:
                  'Compiled pointer → authored pointer. A compiled node maps to its block; a compiled slot region (`…/children/2/props/items`) maps to the authored slot, and anything beneath it carries across.',
              },
            },
            required: ['document', 'blocks', 'sourceMap'],
            additionalProperties: false,
          },
        })
      ),
    },
    async (args) =>
      toolResult(
        await guarded(async () => {
          const adapter = deps.getAdapter(args.format);

          const rendererError = await checkRenderer(adapter, args.renderer);
          if (rendererError) return { ...rendererError, format: args.format };

          const resolved = await resolveDocumentSource(args, deps.workspaces());
          if (!resolved.ok) return { ...resolved, format: args.format };

          const result = adapter.validateDocument(
            withRenderer(resolved.document, args.renderer)
          );
          // Whether the document is well-formed and whether it can be built
          // here are two questions, and answering only the first is what let a
          // clean validation be followed by a render that could never work.
          const unavailable = await rendererAvailability(
            adapter,
            resolved.document,
            args.renderer
          );
          // Third question: schema-valid ≠ well-designed. Advisory by default;
          // an explicit run policy can promote quality into the gate.
          let analysis: QualityAnalysis | undefined;
          let qualityOption: Diagnostic | undefined;
          if (adapter.analyzeQuality) {
            try {
              analysis = await adapter.analyzeQuality(resolved.document, {
                renderer: args.renderer,
                quality: args.quality,
              });
            } catch (error) {
              // Two defects at once — a malformed document AND an unusable
              // profile or policy. `guarded` would answer with the option
              // error alone, dropping the repair list this tool exists to
              // produce, so a broken document keeps its diagnostics and
              // carries the option defect alongside them.
              const option = result.valid
                ? undefined
                : qualityOptionDiagnostic(error);
              if (!option) throw error;
              qualityOption = option;
            }
          }
          const structural = [
            ...validationDiagnostics(result.errors),
            ...(unavailable ? [unavailable] : []),
            ...(qualityOption ? [qualityOption] : []),
          ];
          const all = [
            ...structural,
            ...(analysis
              ? [
                  ...qualityAnalysisDiagnostics(analysis),
                  ...ruleErrorDiagnostics(analysis),
                ]
              : []),
          ];
          const counts = countDiagnostics(all);
          // The compiled form is read off the same preparation the analysis
          // ran on; a document too broken to prepare simply has none.
          let compiled: CompiledBlocks | undefined;
          if (args.includeCompiled && adapter.prepareDocument) {
            try {
              const prepared = await adapter.prepareDocument(
                withRenderer(resolved.document, args.renderer),
                { renderer: args.renderer }
              );
              const blocks = prepared.metadata?.blocks as
                | CompiledBlocks
                | undefined;
              compiled = blocks ?? {
                document: resolved.document,
                sourceMap: {},
                blocks: [],
              };
            } catch {
              compiled = undefined;
            }
          }
          // The gate, not the severity tally. A policy may raise a quality
          // finding to `error` without asking for it to block, and generation
          // would still succeed — so the quality half of the verdict is the
          // engine's `blocked`, which is the only thing that decided it.
          const blocked =
            countDiagnostics(structural).error > 0 ||
            analysis?.blocked === true;
          // The other half of the generation gate: a draft is a legitimate
          // thing to hold and passes here, but jto_generate refuses a marker,
          // so the verdict says which of the two states the document is in.
          const scaffoldMarkers = scaffoldMarkerOccurrences(
            resolved.document
          ).length;
          const { kept, truncated } = capDiagnostics(
            all,
            args.maxDiagnostics ?? DEFAULT_MAX_DIAGNOSTICS
          );

          return {
            ok: !blocked,
            diagnostics: kept,
            valid: !blocked,
            generationReady: !blocked && scaffoldMarkers === 0,
            scaffoldMarkers,
            format: args.format,
            ...(args.renderer !== undefined && { renderer: args.renderer }),
            source: sourceSummary(resolved),
            counts,
            // The engine caps its own list under a policy budget, so a report
            // shortened there would otherwise come back reading complete.
            truncated: truncated || analysis?.truncated === true,
            ...(analysis?.profileId !== undefined && {
              profileId: analysis.profileId,
            }),
            ...(compiled && { compiled }),
          };
        })
      )
  );
}
