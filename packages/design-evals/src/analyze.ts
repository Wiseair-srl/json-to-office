/**
 * The harness's own measurement of a produced document.
 *
 * Runs the real format adapter — the same `analyzeQuality` the MCP server
 * serves — rather than reading whatever the agent's last `jto_validate` said.
 * The agent may never have called it, may have called it on an earlier
 * revision, or may have called it and continued anyway; only a measurement the
 * harness makes itself is a measurement of the document that was shipped.
 *
 * Page count is MEASURED where the host can measure it. Slides are countable
 * from the JSON, but a document's pages are not: the first smoke run reported
 * a six-section market-entry report as "6 pages", against a spec metric that
 * compares pages to a blueprint budget. So when LibreOffice and poppler are
 * present the document is rendered and its real page count read back, and the
 * structural count is the fallback for a host that cannot render — labelled as
 * such on the run, so a mixed corpus is never silently half one and half the
 * other.
 */

import { DocxFormatAdapter, PptxFormatAdapter } from '@json-to-office/jto-ops';

export interface Measurement {
  diagnostics: readonly unknown[];
  pages: number;
  /** `rendered` when a converter counted them; `structural` when it could not. */
  pageCountSource: 'rendered' | 'structural';
}

/** Slides for a deck; top-level sections for a document, at least one. */
export function structuralPages(format: string, document: unknown): number {
  if (typeof document !== 'object' || document === null) return 0;
  const children = (document as { children?: unknown }).children;
  if (!Array.isArray(children)) return 0;
  if (format === 'pptx') {
    return children.filter(
      (child) =>
        typeof child === 'object' &&
        child !== null &&
        (child as { name?: unknown }).name === 'slide' &&
        (child as { enabled?: unknown }).enabled !== false
    ).length;
  }
  const sections = children.filter(
    (child) =>
      typeof child === 'object' &&
      child !== null &&
      (child as { name?: unknown }).name === 'section'
  ).length;
  return Math.max(sections, children.length > 0 ? 1 : 0);
}

/**
 * The real page count and the rendered pass's findings (#344), or undefined
 * when this host cannot render. The same PDF answers both questions.
 */
async function renderedMeasurement(
  format: string,
  document: unknown
): Promise<{ pages: number; diagnostics: readonly unknown[] } | undefined> {
  try {
    const { renderPreview, collectRenderedFindings, getAdapter } = await import(
      '@json-to-office/mcp-server'
    );
    const rendered = await renderPreview({
      format: format as 'docx' | 'pptx',
      document,
      dpi: 36,
      // Nothing looks at these pixels; only the count and the text geometry
      // are wanted, and the cheapest render that produces them is right.
      outputMode: 'path',
      rendered: true,
      getAdapter,
    });
    if (!rendered.ok) return undefined;
    // The page count stands on its own: a fault in the pass must not turn a
    // rendered count back into a structural guess.
    let diagnostics: readonly unknown[] = [];
    if (rendered.rendered) {
      try {
        const findings = await collectRenderedFindings({
          format: format as 'docx' | 'pptx',
          document,
          render: {},
          rendered: rendered.rendered,
          adapter: getAdapter(format as 'docx' | 'pptx'),
        });
        diagnostics = findings.diagnostics;
      } catch {
        diagnostics = [];
      }
    }
    return { pages: rendered.totalPages, diagnostics };
  } catch {
    return undefined;
  }
}

export interface AnalyzeOptions {
  /**
   * Render the document to count its pages. On by default, because a page
   * count is one of the measured metrics — but it launches LibreOffice, and a
   * caller that only wants the diagnostics should not have to wait for a
   * converter or have one at all.
   */
  measurePages?: boolean;
}

export async function analyzeDocument(
  format: string,
  document: unknown,
  options: AnalyzeOptions = {}
): Promise<Measurement> {
  const adapter =
    format === 'pptx' ? new PptxFormatAdapter() : new DocxFormatAdapter();

  const validation = adapter.validateDocument(document);
  const quality = adapter.analyzeQuality
    ? await adapter.analyzeQuality(document)
    : { diagnostics: [] };

  const measured =
    options.measurePages === false
      ? undefined
      : await renderedMeasurement(format, document);

  return {
    diagnostics: [
      ...(validation.errors ?? []).map((error) => ({
        code:
          typeof (error as { code?: unknown }).code === 'string'
            ? (error as { code: string }).code
            : 'E_INVALID_DOCUMENT',
        severity: 'error' as const,
      })),
      ...quality.diagnostics,
      ...(measured?.diagnostics ?? []),
    ],
    pages: measured?.pages ?? structuralPages(format, document),
    pageCountSource: measured === undefined ? 'structural' : 'rendered',
  };
}
