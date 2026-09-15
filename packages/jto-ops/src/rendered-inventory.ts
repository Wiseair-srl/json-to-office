/**
 * The authored side of the rendered pass (#344): the text inventory and the
 * requested font families, read off a prepared document's quality facts.
 *
 * `jto_preview` and the ground-truth harness both hand the pass this, so the
 * mapping a measurement scores is the mapping the tool ships. Every pointer
 * in it has already been through the block source maps, and lands on a slot
 * the author can patch.
 */

import type { QualityFact } from '@json-to-office/quality';
import type { FormatName } from './format-adapter';
import type { RenderedTextEntry, RequestedFont } from './rendered-analysis';

type Rec = Record<string, unknown>;

/** The text inventory a format's facts expose, as the analysis reads it. */
export function renderedInventoryFromFacts(
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
        ...(fact.optional === true && { optional: true }),
        ...(frame && {
          box: {
            ...(frame.widthPt !== undefined && { widthPt: frame.widthPt }),
            ...(frame.heightPt !== undefined && { heightPt: frame.heightPt }),
          },
        }),
      });
    } else if (format === 'pptx' && fact.kind === 'pptx/text') {
      // A hidden slide is left out of the export: its text is on no page,
      // and looking for it would only claim a visible slide's words.
      if (fact.slideHidden === true) continue;
      // Text set at an angle comes out of the PDF as per-glyph fragments in
      // no reading order, and its box no longer bounds it on the page's
      // axes: it claims an occurrence when one matches, is never reported
      // missing, and is held to no box.
      const turned =
        typeof fact.rotationDeg === 'number' &&
        ((fact.rotationDeg % 360) + 360) % 360 !== 0;
      if (turned) {
        entries.push({
          path: fact.path,
          text: String(fact.text),
          role: 'slide-text',
          optional: true,
          ...(typeof fact.page === 'number' && { page: fact.page }),
        });
        continue;
      }
      const { boxXPt: x, boxYPt: y } = fact;
      const widthPt = fact.boxWidthPt;
      const heightPt = fact.boxHeightPt;
      entries.push({
        path: fact.path,
        text: String(fact.text),
        role: 'slide-text',
        // A slide is its own page and its boxes are where the deck put
        // them, so the text is looked for there before anywhere else.
        ...(typeof fact.page === 'number' && { page: fact.page }),
        ...(typeof x === 'number' &&
          typeof y === 'number' &&
          typeof widthPt === 'number' &&
          typeof heightPt === 'number' && {
            region: {
              xMin: x,
              yMin: y,
              xMax: x + widthPt,
              yMax: y + heightPt,
            },
          }),
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
