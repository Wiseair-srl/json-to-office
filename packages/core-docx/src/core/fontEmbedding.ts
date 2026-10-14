/**
 * The `embed` export mode's share of the DOCX pipeline: whether this render
 * embeds at all, which faces it embeds, and the one summary warning.
 *
 * Face selection itself — slots, formats, licence bits — lives in
 * `@json-to-office/shared/fonts/node` (`toEmbeddedFontFaces`), beside the
 * other encoders of resolved fonts. What stays here is what only the DOCX
 * pipeline knows: which renderer will write the package, and what the
 * document references, which is what the summary has to answer for.
 *
 * Nothing here imports `docx`: the faces travel to the adapter as a render
 * option (`DocxRenderOptions.embeddedFonts`), and only the docx.js adapter
 * reads it.
 */

import type {
  EmbeddedFontFace,
  FontRuntimeOpts,
  GenerationWarning,
  ResolvedFont,
} from '@json-to-office/shared';
import { isSafeFont } from '@json-to-office/shared';
import {
  toEmbeddedFontFaces,
  type EmbeddedFontFamilyReport,
} from '@json-to-office/shared/fonts/node';
import {
  DEFAULT_DOCX_RENDERER_ID,
  type DocxRendererId,
} from '../renderers/types';

/** The one backend that writes embedded fonts: docx.js 9.10 or later. */
const EMBEDDING_RENDERER: DocxRendererId = 'docxjs';

const warning = (code: string, message: string): GenerationWarning => ({
  component: 'fontRegistry',
  message,
  severity: 'warning',
  context: { code },
});

/**
 * Whether this render embeds fonts: `embed` was asked for, and the renderer
 * that will write the package can do it.
 *
 * `office-open` cannot yet. Its published docx embedding names the part after
 * the family, which is the defect docx.js fixed in 9.7.0, writes the regular
 * face only and leaves `embedTrueTypeFonts` off, so a request for it falls
 * back to `custom` — references kept, nothing embedded — and says so rather
 * than shipping a package Word repairs or drops the fonts from on re-save.
 */
export function embedsFonts(
  fonts: FontRuntimeOpts | undefined,
  renderer: DocxRendererId | undefined,
  warnings: GenerationWarning[]
): boolean {
  if (fonts?.mode !== 'embed') return false;
  const id = renderer ?? DEFAULT_DOCX_RENDERER_ID;
  if (id === EMBEDDING_RENDERER) return true;
  warnings.push(
    warning(
      'FONT_EMBED_UNSUPPORTED_RENDERER',
      `Export mode "embed" needs the ${EMBEDDING_RENDERER} renderer; the ` +
        `${id} renderer does not embed fonts, so references are kept as in ` +
        `custom mode and nothing is embedded.`
    )
  );
  return false;
}

/**
 * The faces to embed, with one `FONT_MODE_EMBED` summary for the document.
 *
 * The summary walks the resolved fonts rather than the report alone: the
 * resolver hands back one entry per family the document and its theme
 * reference — the same set `FONT_MODE_CUSTOM` is gated on — so a non-safe
 * family that resolved to nothing still gets its line, instead of vanishing
 * from a message that claims to account for the document's fonts. A document
 * that references only safe fonts gets no summary, as in custom mode.
 */
export function selectEmbeddedFonts(
  resolved: readonly ResolvedFont[],
  warnings: GenerationWarning[]
): EmbeddedFontFace[] {
  const { faces, report } = toEmbeddedFontFaces(resolved, warnings);
  const summary = embedSummary(resolved, report);
  if (summary) warnings.push(warning('FONT_MODE_EMBED', summary));
  return faces;
}

function embedSummary(
  resolved: readonly ResolvedFont[],
  report: readonly EmbeddedFontFamilyReport[]
): string | undefined {
  const byFamily = new Map(report.map((r) => [r.family.toLowerCase(), r]));
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const font of resolved) {
    const key = font.family.toLowerCase();
    if (isSafeFont(font.family.trim()) || seen.has(key)) continue;
    seen.add(key);
    const entry = byFamily.get(key);
    if (!entry) {
      lines.push(`${font.family}: not embedded (unresolved)`);
    } else if (entry.slots.length === 0) {
      lines.push(
        `${font.family}: not embedded (${
          entry.reason === 'no-regular-face'
            ? 'no regular face'
            : 'no TTF/OTF face it may embed'
        })`
      );
    } else {
      const nearest = entry.nearest.length
        ? ` (${entry.nearest.map((n) => `${n.slot} ← ${n.weight}`).join(', ')})`
        : '';
      lines.push(`${font.family}: ${entry.slots.join(', ')}${nearest}`);
    }
  }
  if (lines.length === 0) return undefined;
  return (
    `Export mode "embed": ${lines.join('; ')}. Readers without these fonts ` +
    `installed see the embedded faces; any face or family not embedded stays ` +
    `a reference, as in custom mode.`
  );
}
