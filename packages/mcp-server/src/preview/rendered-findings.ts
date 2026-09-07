/**
 * Rendered findings for `jto_preview` (#344).
 *
 * `renderPreview` reads word geometry and fonts off the PDF; the analysis in
 * `jto-ops` turns them into findings. What sits between is the authored
 * side: the document's text inventory and requested font families, read
 * from the same prepared document `jto_validate` analyses — so every
 * pointer a rendered finding carries went through the block source maps and
 * lands on a slot the author can patch.
 */

import {
  analyzeRenderedDocument,
  type RenderedAnalysisSummary,
  type RenderedTextEntry,
  type RequestedFont,
} from '@json-to-office/jto-ops';
import type { QualityFact } from '@json-to-office/quality';

import type { FormatAdapter, FormatName } from '../lib/adapters.js';
import {
  PREVIEW_ERROR_CODES as CODES,
  type PreviewErrorCode,
} from './codes.js';
import {
  diagnostic,
  qualityDiagnosticToEnvelope,
  type Diagnostic,
} from '../lib/errors.js';
import type { RenderOptionsInput } from '../lib/schema.js';
import type { RenderedGeometry } from './render.js';

export interface RenderedFindingsInput {
  format: FormatName;
  document: unknown;
  render: RenderOptionsInput;
  rendered: RenderedGeometry;
  adapter: Pick<FormatAdapter, 'prepareDocument'>;
}

export interface RenderedFindings {
  diagnostics: Diagnostic[];
  /** Absent when the pass could not run; the diagnostics say why. */
  summary?: RenderedAnalysisSummary;
}

type Rec = Record<string, unknown>;

/** The text inventory a format's facts expose, as the analysis reads it. */
export function inventoryFromFacts(
  format: FormatName,
  facts: readonly QualityFact[]
): RenderedTextEntry[] {
  const entries: RenderedTextEntry[] = [];
  for (const fact of facts as readonly (QualityFact & Rec)[]) {
    if (format === 'docx' && fact.kind === 'docx/text') {
      const frame = fact.frame as
        | { widthPt?: number; heightPt?: number }
        | undefined;
      entries.push({
        path: fact.path,
        text: String(fact.text),
        role: fact.role as RenderedTextEntry['role'],
        ...(typeof fact.level === 'number' && { level: fact.level }),
        ...(fact.repeats === true && { repeats: true }),
        ...(frame && {
          box: {
            ...(frame.widthPt !== undefined && { widthPt: frame.widthPt }),
            ...(frame.heightPt !== undefined && { heightPt: frame.heightPt }),
          },
        }),
      });
    } else if (format === 'pptx' && fact.kind === 'pptx/text') {
      const widthPt = fact.boxWidthPt;
      const heightPt = fact.boxHeightPt;
      entries.push({
        path: fact.path,
        text: String(fact.text),
        role: 'slide-text',
        ...((typeof widthPt === 'number' || typeof heightPt === 'number') && {
          box: {
            ...(typeof widthPt === 'number' && { widthPt }),
            ...(typeof heightPt === 'number' && { heightPt }),
          },
        }),
      });
    }
  }
  return entries;
}

/**
 * Families the pass should find in the PDF: every family the document's
 * text uses (a `font-family` fact, with its pointer) plus every family the
 * render resolved from a declared source. A theme family nothing on the page
 * uses — the default mono face in a report without code — is never embedded
 * and must not read as substituted.
 */
export function requestedFontsFromFacts(
  format: FormatName,
  facts: readonly QualityFact[],
  resolvedFonts: readonly { family: string; declared: boolean }[]
): RequestedFont[] {
  const kind = format === 'docx' ? 'docx/font-family' : 'pptx/font-family';
  const declared = new Set(
    resolvedFonts
      .filter((font) => font.declared)
      .map((font) => font.family.trim().toLowerCase())
  );
  const seen = new Set<string>();
  const requested: RequestedFont[] = [];
  const add = (family: unknown, path?: string) => {
    if (typeof family !== 'string' || family.trim() === '') return;
    const key = family.trim().toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    requested.push({
      family: family.trim(),
      ...(path && { path }),
      ...(declared.has(key) && { declared: true }),
    });
  };
  for (const fact of facts as readonly (QualityFact & Rec)[]) {
    if (fact.kind === kind) add(fact.family, fact.path);
  }
  for (const font of resolvedFonts) if (font.declared) add(font.family);
  return requested;
}

function skipped(code: PreviewErrorCode, message: string): RenderedFindings {
  return { diagnostics: [diagnostic(code, message, { severity: 'warning' })] };
}

/** Run the rendered pass over a preview's geometry. */
export async function collectRenderedFindings(
  input: RenderedFindingsInput
): Promise<RenderedFindings> {
  if (!input.adapter.prepareDocument) {
    return skipped(
      CODES.RENDERED_UNAVAILABLE,
      `The ${input.format} adapter exposes no prepared document, so rendered findings cannot be mapped.`
    );
  }
  let facts: readonly QualityFact[];
  try {
    const prepared = await input.adapter.prepareDocument(input.document, {
      ...input.render,
      warnings: [],
    });
    facts = prepared.facts;
  } catch (error) {
    return skipped(
      CODES.RENDERED_UNAVAILABLE,
      `Rendered findings were skipped: the document could not be prepared for mapping (${
        error instanceof Error ? error.message : String(error)
      }).`
    );
  }
  const analysis = analyzeRenderedDocument({
    format: input.format,
    pages: input.rendered.pages,
    inventory: inventoryFromFacts(input.format, facts),
    ...(input.rendered.fonts && { fonts: input.rendered.fonts }),
    requestedFonts: requestedFontsFromFacts(
      input.format,
      facts,
      input.rendered.resolvedFonts
    ),
  });
  return {
    diagnostics: analysis.findings.map(qualityDiagnosticToEnvelope),
    summary: analysis.summary,
  };
}
