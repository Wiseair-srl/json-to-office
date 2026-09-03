/**
 * The harness's own measurement of a produced document.
 *
 * Runs the real format adapter — the same `analyzeQuality` the MCP server
 * serves — rather than reading whatever the agent's last `jto_validate` said.
 * The agent may never have called it, may have called it on an earlier
 * revision, or may have called it and continued anyway; only a measurement the
 * harness makes itself is a measurement of the document that was shipped.
 *
 * Page count is deliberately cheap: slides for pptx are countable from the
 * JSON, and a docx page count would need a LibreOffice render per run. The
 * rendered pass (#344) is where real pagination arrives; until then this
 * reports the structural size, which is what the estimator's other metrics are
 * already scaled to.
 */

import { DocxFormatAdapter, PptxFormatAdapter } from '@json-to-office/jto-ops';

export interface Measurement {
  diagnostics: readonly unknown[];
  pages: number;
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

export async function analyzeDocument(
  format: string,
  document: unknown
): Promise<Measurement> {
  const adapter =
    format === 'pptx' ? new PptxFormatAdapter() : new DocxFormatAdapter();

  const validation = adapter.validateDocument(document);
  const quality = adapter.analyzeQuality
    ? await adapter.analyzeQuality(document)
    : { diagnostics: [] };

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
    ],
    pages: structuralPages(format, document),
  };
}
