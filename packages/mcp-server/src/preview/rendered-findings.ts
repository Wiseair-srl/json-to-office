/**
 * Rendered findings for `jto_preview` (#344).
 *
 * `renderPreview` reads word geometry and fonts off the PDF; the analysis in
 * `jto-ops` turns them into findings. What sits between is the authored
 * side: the document's text inventory and requested font families, which
 * `jto-ops` reads off the same prepared document `jto_validate` analyses —
 * so every pointer a rendered finding carries went through the block source
 * maps and lands on a slot the author can patch.
 *
 * The pass runs under the same profile and policy `jto_validate` would use:
 * the caller's, else the one the document declares, else the format's
 * default. A rendered finding a profile disables, a policy suppresses or a
 * gate makes blocking reads the same on both tools.
 */

import {
  analyzeRenderedDocument,
  renderedInventoryFromFacts,
  requestedFontsFromFacts,
  type RenderedAnalysisSummary,
} from '@json-to-office/jto-ops';
import type {
  PreparedDocument,
  QualityFact,
  QualityProfile,
} from '@json-to-office/quality';

import type { FormatAdapter, FormatName } from '../lib/adapters.js';
import {
  PREVIEW_ERROR_CODES as CODES,
  type PreviewErrorCode,
} from './codes.js';
import { loadCore } from '../lib/core.js';
import {
  diagnostic,
  qualityDiagnosticToEnvelope,
  qualityOptionDiagnostic,
  ruleErrorDiagnostics,
  type Diagnostic,
} from '../lib/errors.js';
import type { QualityOptionsInput, RenderOptionsInput } from '../lib/schema.js';
import type { RenderedGeometry } from './render.js';

export interface RenderedFindingsInput {
  format: FormatName;
  document: unknown;
  render: RenderOptionsInput;
  rendered: RenderedGeometry;
  /**
   * The prepared document the preview rendered from. Given, the inventory
   * is read off it; absent, the adapter prepares the document here.
   */
  prepared?: PreparedDocument;
  adapter: Pick<FormatAdapter, 'prepareDocument'>;
  /** The design profile and policy to judge by; see `resolveQualityProfile`. */
  quality?: QualityOptionsInput;
}

export interface RenderedFindings {
  diagnostics: Diagnostic[];
  /** Absent when the pass could not run; the diagnostics say why. */
  summary?: RenderedAnalysisSummary;
}

/**
 * The pass could not run. No summary: a zero-filled one would read as "no
 * findings" when the truth is that nothing was looked at.
 */
function skipped(code: PreviewErrorCode, message: string): RenderedFindings {
  return { diagnostics: [diagnostic(code, message, { severity: 'warning' })] };
}

/**
 * The profile the pass judges by, as the format's core resolves it for
 * `jto_validate`: the caller's profile layered over the shipped one of that
 * id, else the document's declared profile, else the format default.
 */
export async function resolveQualityProfile(
  format: FormatName,
  document: unknown,
  requested: QualityProfile | undefined
): Promise<QualityProfile | undefined> {
  const core = await loadCore(format);
  if (!core) return requested;
  let parsed = document;
  if (typeof document === 'string') {
    try {
      parsed = JSON.parse(document);
    } catch {
      parsed = undefined;
    }
  }
  return core.resolveProfile(parsed, requested);
}

/** Run the rendered pass over a preview's geometry. */
export async function collectRenderedFindings(
  input: RenderedFindingsInput
): Promise<RenderedFindings> {
  let prepared = input.prepared;
  if (!prepared) {
    if (!input.adapter.prepareDocument) {
      return skipped(
        CODES.RENDERED_UNAVAILABLE,
        `The ${input.format} adapter exposes no prepared document, so rendered findings cannot be mapped.`
      );
    }
    try {
      prepared = await input.adapter.prepareDocument(input.document, {
        ...input.render,
        warnings: [],
      });
    } catch (error) {
      return skipped(
        CODES.RENDERED_UNAVAILABLE,
        `Rendered findings were skipped: the document could not be prepared for mapping (${
          error instanceof Error ? error.message : String(error)
        }).`
      );
    }
  }
  const facts: readonly QualityFact[] = prepared.facts;
  const profile = await resolveQualityProfile(
    input.format,
    input.document,
    input.quality?.profile
  );
  let analysis: ReturnType<typeof analyzeRenderedDocument>;
  try {
    analysis = analyzeRenderedDocument(
      {
        format: input.format,
        ...(prepared.renderer !== undefined && { renderer: prepared.renderer }),
        pages: input.rendered.pages,
        inventory: renderedInventoryFromFacts(input.format, facts),
        ...(input.rendered.fonts && { fonts: input.rendered.fonts }),
        requestedFonts: requestedFontsFromFacts(
          input.format,
          facts,
          input.rendered.resolvedFonts
        ),
      },
      {
        ...(profile && { profile }),
        ...(input.quality?.policy && { policy: input.quality.policy }),
      }
    );
  } catch (error) {
    // An unusable profile or policy is the caller's defect, reported as the
    // option error `jto_validate` would give; anything else is a bug.
    const option = qualityOptionDiagnostic(error);
    if (!option) throw error;
    return { diagnostics: [option] };
  }
  return {
    // A rule that failed is reported, as `jto_validate` reports it: a clean
    // summary with eight rules that never ran would read as "no defects".
    diagnostics: [
      ...analysis.findings.map(qualityDiagnosticToEnvelope),
      ...ruleErrorDiagnostics(analysis.analysis),
    ],
    summary: analysis.summary,
  };
}
