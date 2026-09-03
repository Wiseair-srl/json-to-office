/**
 * A produced document, as an image a judge can look at.
 *
 * The same pipeline the MCP server previews with, and the same contact-sheet
 * composition an agent gets from `jto_preview` — one image, every page,
 * numbered. Reusing it rather than rendering some other way keeps the thing
 * being judged identical to the thing an author would have looked at.
 */

import {
  buildContactSheet,
  renderPreview,
  type ContactSheet,
} from '@json-to-office/mcp-server';
import { getAdapter } from '@json-to-office/mcp-server';

import type { BriefFormat } from './corpus.js';

/** Small enough to sit inside one vision request, large enough to read. */
const JUDGING_DPI = 72;
const JUDGING_THUMBNAIL_WIDTH = 320;

export interface RenderedDocument {
  sheet: ContactSheet;
  totalPages: number;
}

export class RenderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RenderError';
  }
}

export async function renderForJudging(
  format: BriefFormat,
  document: unknown
): Promise<RenderedDocument> {
  const rendered = await renderPreview({
    format,
    document,
    dpi: JUDGING_DPI,
    // The pages are never delivered individually, so the per-page inline
    // budget must not refuse a twenty-slide deck before anything is composed.
    outputMode: 'path',
    getAdapter,
  });
  if (!rendered.ok) {
    throw new RenderError(
      rendered.diagnostics.map((entry) => entry.message).join('; ') ||
        'the preview failed with no diagnostics'
    );
  }
  return {
    sheet: buildContactSheet(rendered.pages, {
      thumbnailWidth: JUDGING_THUMBNAIL_WIDTH,
    }),
    totalPages: rendered.totalPages,
  };
}
