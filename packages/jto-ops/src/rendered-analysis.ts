/**
 * The rendered-certainty pass (#344): findings from what LibreOffice
 * actually laid out, mapped back to the pointers that authored them.
 *
 * Static rules predict; this pass measures. It reads per-word geometry from
 * the preview PDF, the fonts the PDF embeds, and the document's authored
 * text inventory, and reports the defects only ink can show: text past the
 * page or its frame, words drawn over each other, text that never rendered
 * (fully clipped, or set in a place poppler cannot read), faces substituted
 * on the way, pages with nothing on them, headings stranded at a page foot
 * and paragraphs split into a lone line.
 *
 * Every finding carries `certainty: 'rendered'` and an explicit mapping
 * status. A defect whose words match no inventory entry is still reported,
 * at the document root, as `unmapped` — an unmapped finding is a mapping
 * gap to close, never a defect to hide.
 *
 * Pure: geometry and fonts are extracted by the caller (see
 * `extractPdfTextGeometry`, `extractPdfFonts`), so every rule here is
 * testable from captured fixtures with no converter on the host.
 */

import {
  QUALITY_CODES,
  type QualityCategory,
  type QualityDiagnostic,
  type DiagnosticSeverity,
} from '@json-to-office/quality';
import type { PdfFontInfo } from './pdf-fonts';
import { familyRendered } from './pdf-fonts';
import type { PdfTextPage, PdfTextWord } from './pdf-text-geometry';
import {
  assignInventory,
  type InventoryEntry,
  type InventoryMatch,
  type MappingStatus,
  type OccurrencePart,
} from './rendered-text-match';

/** One authored string the pass can match rendered words back to. */
export interface RenderedTextEntry extends InventoryEntry {
  role:
    | 'heading'
    | 'body'
    | 'list-item'
    | 'table-header'
    | 'table-cell'
    | 'statistic'
    | 'caption'
    | 'chrome'
    | 'slide-text';
  level?: number;
  /** A declared box the text must fit: a docx frame, a pptx text box. */
  box?: { widthPt?: number; heightPt?: number };
}

export interface RequestedFont {
  family: string;
  /** Where the family was requested, when the document names it. */
  path?: string;
  /**
   * The document supplied a source for the family (a file, a URL), so the
   * preview should have had it and a substitution is the document's defect.
   * Without one the family is a host font — Calibri on a Mac without Office
   * — and the substitution says something about the preview, not the file.
   */
  declared?: boolean;
}

export interface RenderedAnalysisInput {
  format: 'docx' | 'pptx';
  pages: readonly PdfTextPage[];
  inventory: readonly RenderedTextEntry[];
  /** Fonts the PDF carries; `undefined` when the host could not inspect them. */
  fonts?: readonly PdfFontInfo[];
  requestedFonts?: readonly RequestedFont[];
}

/** How a finding reached its pointer — always on `context.mapping`. */
export type RenderedMapping = 'mapped' | 'ambiguous' | 'unmapped';

export interface RenderedAnalysisSummary {
  pages: number;
  words: number;
  /** Inventory entries by mapping outcome. */
  inventory: Record<MappingStatus, number>;
  /** Findings by mapping outcome. */
  findings: Record<RenderedMapping, number>;
  fonts?: { requested: number; substituted: number };
}

export interface RenderedAnalysis {
  findings: QualityDiagnostic[];
  summary: RenderedAnalysisSummary;
}

/** Spill below this is sub-visual: renderer rounding, descender fuzz. */
export const VISIBLE_SPILL_PT = 2;
/** Two words overlap when their intersection covers this much of the smaller. */
const OVERLAP_FRACTION = 0.3;

type RuleId =
  | 'rendered/clip'
  | 'rendered/spill'
  | 'rendered/overlap'
  | 'rendered/text-missing'
  | 'rendered/font-substituted'
  | 'rendered/empty-page'
  | 'rendered/heading-stranded'
  | 'rendered/paragraph-split';

interface FindingDraft {
  ruleId: RuleId;
  code: string;
  category: QualityCategory;
  severity: DiagnosticSeverity;
  message: string;
  path: string;
  mapping: RenderedMapping;
  page?: number;
  suggestion?: string;
  relatedPaths?: string[];
  evidence?: QualityDiagnostic['evidence'];
  context?: Record<string, unknown>;
}

function finding(draft: FindingDraft): QualityDiagnostic {
  const { ruleId, mapping, page, context, ...rest } = draft;
  return {
    source: 'quality',
    ruleId,
    certainty: 'rendered',
    blocking: false,
    ...rest,
    context: {
      ...context,
      mapping,
      ...(page !== undefined && { page }),
    },
  };
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

function intersects(a: PdfTextWord, b: PdfTextWord): number {
  const w = Math.min(a.xMax, b.xMax) - Math.max(a.xMin, b.xMin);
  const h = Math.min(a.yMax, b.yMax) - Math.max(a.yMin, b.yMin);
  return w > 0 && h > 0 ? w * h : 0;
}

function area(w: PdfTextWord): number {
  return Math.max(0, w.xMax - w.xMin) * Math.max(0, w.yMax - w.yMin);
}

function excerpt(text: string, max = 60): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** Word → the inventory entry whose match covers it. */
function wordOwners(
  matches: readonly InventoryMatch<RenderedTextEntry>[]
): Map<string, InventoryMatch<RenderedTextEntry>> {
  const owners = new Map<string, InventoryMatch<RenderedTextEntry>>();
  for (const match of matches) {
    if (match.status !== 'mapped') continue;
    for (const o of match.occurrences) {
      for (const part of o.parts) {
        for (const w of part.words) owners.set(`${part.pageIndex}:${w}`, match);
      }
    }
  }
  return owners;
}

/** Line index for every word of a page, when poppler grouped lines. */
const lineMaps = new WeakMap<PdfTextPage, Map<number, number>>();
function lineOfWord(page: PdfTextPage): Map<number, number> {
  const cached = lineMaps.get(page);
  if (cached) return cached;
  const lines = new Map<number, number>();
  page.lines.forEach((line, index) => {
    for (const w of line.words) lines.set(w, index);
  });
  lineMaps.set(page, lines);
  return lines;
}

/** The box around every part of an occurrence. */
function unionBox(parts: readonly OccurrencePart[]) {
  return parts.reduce(
    (box, part) => ({
      xMin: Math.min(box.xMin, part.xMin),
      yMin: Math.min(box.yMin, part.yMin),
      xMax: Math.max(box.xMax, part.xMax),
      yMax: Math.max(box.yMax, part.yMax),
    }),
    { xMin: Infinity, yMin: Infinity, xMax: -Infinity, yMax: -Infinity }
  );
}

/** Run the pass. */
export function analyzeRenderedDocument(
  input: RenderedAnalysisInput
): RenderedAnalysis {
  const { pages, format } = input;
  const { matches, chromeWords } = assignInventory(pages, input.inventory);
  const owners = wordOwners(matches);
  const findings: QualityDiagnostic[] = [];

  const ownerOf = (pageIndex: number, word: number) =>
    owners.get(`${pageIndex}:${word}`);

  // -- Clip: a word past the page edge. Reported once per entry, with the
  // count, so a paragraph running off the page is one finding, not sixty.
  const clipped = new Map<
    string,
    {
      match?: InventoryMatch<RenderedTextEntry>;
      words: PdfTextWord[];
      page: number;
      maxPt: number;
    }
  >();
  pages.forEach((page, pageIndex) => {
    page.words.forEach((word, index) => {
      const beyond = Math.max(
        -word.xMin,
        word.xMax - page.widthPt,
        -word.yMin,
        word.yMax - page.heightPt
      );
      if (beyond <= VISIBLE_SPILL_PT) return;
      const owner = ownerOf(pageIndex, index);
      const key = owner ? `entry:${owner.entry.path}` : `page:${pageIndex}`;
      const bucket = clipped.get(key) ?? {
        match: owner,
        words: [],
        page: pageIndex + 1,
        maxPt: 0,
      };
      bucket.words.push(word);
      bucket.maxPt = Math.max(bucket.maxPt, beyond);
      clipped.set(key, bucket);
    });
  });
  for (const bucket of clipped.values()) {
    const sample = excerpt(bucket.words.map((w) => w.text).join(' '));
    findings.push(
      finding({
        ruleId: 'rendered/clip',
        code: QUALITY_CODES.RENDERED_CLIP,
        category: 'integrity',
        severity: 'warning',
        mapping: bucket.match ? 'mapped' : 'unmapped',
        page: bucket.page,
        path: bucket.match?.entry.path ?? '',
        message: `${bucket.words.length} word${bucket.words.length === 1 ? '' : 's'} rendered past the page edge on page ${bucket.page} by up to ${round(bucket.maxPt)} pt: "${sample}".`,
        suggestion:
          'Shorten the text, allow it to wrap, or widen the column or frame that holds it; text outside the page is cut off in print and in Word.',
        evidence: {
          summary: 'Word boxes beyond the page bounds',
          actual: round(bucket.maxPt),
          expected: 0,
          unit: 'pt',
          values: { words: bucket.words.length },
        },
      })
    );
  }

  // -- Truncation: only the head of an entry rendered. The tail went past
  // a frame, a box or the page, wherever poppler stopped seeing it.
  for (const match of matches) {
    if (!match.partial || match.status !== 'mapped') continue;
    const o = match.occurrences[0];
    const shown = Math.round(
      (100 * match.partial.matchedChars) / match.partial.totalChars
    );
    findings.push(
      finding({
        ruleId: 'rendered/clip',
        code: QUALITY_CODES.RENDERED_CLIP,
        category: 'integrity',
        severity: 'warning',
        mapping: 'mapped',
        page: o.endPageIndex + 1,
        path: match.entry.path,
        message: `"${excerpt(match.entry.text)}" is cut off: about ${shown}% of it rendered on page ${o.endPageIndex + 1} and the rest is nowhere on the page.`,
        suggestion:
          'Shorten the text or enlarge the frame, box or cell that holds it; what did not render here will not print either.',
        evidence: {
          summary: 'Share of the authored text found in the PDF',
          actual: shown,
          expected: 100,
          unit: '%',
          values: match.partial,
        },
        context: { kind: 'truncated' },
      })
    );
  }

  // -- Spill: a matched entry drawn larger than the box it declared.
  for (const match of matches) {
    const box = match.entry.box;
    if (!box || match.status !== 'mapped') continue;
    for (const o of match.occurrences) {
      const extent = unionBox(o.parts);
      const rendered = {
        heightPt: extent.yMax - extent.yMin,
        widthPt: extent.xMax - extent.xMin,
      };
      const worst = (['heightPt', 'widthPt'] as const)
        .filter((axis) => box[axis] !== undefined)
        .map((axis) => ({
          axis,
          declared: box[axis] as number,
          rendered: rendered[axis],
          over: rendered[axis] - (box[axis] as number),
        }))
        .sort((a, b) => b.over - a.over)[0];
      if (!worst || worst.over <= VISIBLE_SPILL_PT) continue;
      const word = worst.axis === 'heightPt' ? 'taller' : 'wider';
      findings.push(
        finding({
          ruleId: 'rendered/spill',
          code: QUALITY_CODES.RENDERED_SPILL,
          category: 'integrity',
          severity: 'warning',
          mapping: 'mapped',
          page: o.pageIndex + 1,
          path: match.entry.path,
          message: `"${excerpt(match.entry.text)}" rendered ${round(worst.over)} pt ${word} than its ${round(worst.declared)} pt box on page ${o.pageIndex + 1}.`,
          suggestion:
            'Shorten the text, reduce its size, or enlarge the box; the renderer let it spill past the edge the author drew.',
          evidence: {
            summary: 'Rendered extent against the declared box',
            actual: round(worst.rendered),
            expected: round(worst.declared),
            unit: 'pt',
            values: { marginPt: round(-worst.over) },
          },
        })
      );
    }
  }

  // -- Overlap: two words from different lines drawn over each other.
  pages.forEach((page, pageIndex) => {
    const lines = lineOfWord(page);
    const seen = new Set<string>();
    const words = page.words;
    // Sorted by top edge so the inner loop stops at the first word that
    // starts below the outer one: nothing after it can intersect.
    const byTop = words
      .map((_, i) => i)
      .sort((a, b) => words[a].yMin - words[b].yMin);
    for (let p = 0; p < byTop.length; p++) {
      const i = byTop[p];
      const a = words[i];
      for (let q = p + 1; q < byTop.length; q++) {
        const j = byTop[q];
        const b = words[j];
        if (b.yMin >= a.yMax) break;
        const shared = intersects(a, b);
        if (shared <= 0) continue;
        const lineA = lines.get(i);
        if (lineA !== undefined && lineA === lines.get(j)) continue;
        const smaller = Math.min(area(a), area(b));
        if (smaller <= 0 || shared / smaller < OVERLAP_FRACTION) continue;
        const ownerA = ownerOf(pageIndex, i);
        const ownerB = ownerOf(pageIndex, j);
        const pathA = ownerA?.entry.path ?? '';
        const pathB = ownerB?.entry.path ?? '';
        // One finding per authored pair; unmapped pairs are each their own.
        const key =
          pathA && pathB
            ? [pathA, pathB].sort().join('|')
            : `${Math.min(i, j)}:${Math.max(i, j)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const mapping: RenderedMapping =
          ownerA && ownerB
            ? 'mapped'
            : ownerA || ownerB
              ? 'ambiguous'
              : 'unmapped';
        findings.push(
          finding({
            ruleId: 'rendered/overlap',
            code: QUALITY_CODES.RENDERED_OVERLAP,
            category: 'integrity',
            severity: 'warning',
            mapping,
            page: pageIndex + 1,
            path: pathA || pathB,
            ...(pathA && pathB && pathA !== pathB && { relatedPaths: [pathB] }),
            message: `"${a.text}" and "${b.text}" are drawn over each other on page ${pageIndex + 1}.`,
            suggestion:
              'Give the two elements separate room: move one, reduce the text, or increase the spacing between them.',
            evidence: {
              summary: 'Word boxes intersect',
              actual: round((100 * shared) / smaller),
              expected: 0,
              unit: '% of the smaller word',
            },
          })
        );
      }
    }
  });

  // -- Missing: authored text that never rendered anywhere.
  for (const match of matches) {
    if (match.status !== 'missing') continue;
    findings.push(
      finding({
        ruleId: 'rendered/text-missing',
        code: QUALITY_CODES.RENDERED_TEXT_MISSING,
        category: 'integrity',
        severity: 'warning',
        mapping: 'mapped',
        path: match.entry.path,
        message: `"${excerpt(match.entry.text)}" does not appear anywhere in the rendered pages.`,
        suggestion:
          'The text was fully clipped, hidden behind another element, or set somewhere the renderer could not place it; preview the page it belongs to.',
        evidence: { summary: 'No rendered occurrence of the authored text' },
        context: { role: match.entry.role },
      })
    );
  }

  // -- Font substitution: a requested family absent from the PDF.
  let substituted = 0;
  if (input.fonts && input.fonts.length > 0 && input.requestedFonts) {
    const seen = new Set<string>();
    for (const requested of input.requestedFonts) {
      const family = requested.family.trim();
      if (family === '' || seen.has(family.toLowerCase())) continue;
      seen.add(family.toLowerCase());
      if (familyRendered(family, input.fonts)) continue;
      substituted += 1;
      findings.push(
        finding({
          ruleId: 'rendered/font-substituted',
          code: QUALITY_CODES.RENDERED_FONT_SUBSTITUTED,
          category: 'brand',
          severity: requested.declared ? 'warning' : 'info',
          mapping: requested.path ? 'mapped' : 'unmapped',
          path: requested.path ?? '',
          message: requested.declared
            ? `"${family}" was declared with a source but the rendered PDF embeds no face of it; the renderer substituted another family.`
            : `"${family}" is not installed on this host, so the preview substituted another family; a recipient with the font sees the intended face.`,
          suggestion: requested.declared
            ? 'Check the font source: the file or URL must resolve to a face LibreOffice can load, or the recipient will see the same substitution.'
            : 'Install the family on the host for a faithful preview, or declare a source for it in the document fonts so every renderer has it.',
          context: { declared: requested.declared === true },
          evidence: {
            summary: 'Requested family against embedded PDF fonts',
            expected: family,
            actual: [...new Set(input.fonts.map((f) => f.baseName))].join(', '),
          },
        })
      );
    }
  }

  // -- Empty pages: no text at all. A full-page figure is legitimate, so
  // this is information, not a warning.
  pages.forEach((page, pageIndex) => {
    if (page.words.length > 0) return;
    findings.push(
      finding({
        ruleId: 'rendered/empty-page',
        code: QUALITY_CODES.RENDERED_EMPTY_PAGE,
        category: 'integrity',
        severity: 'info',
        mapping: 'unmapped',
        page: pageIndex + 1,
        path: '',
        message: `Page ${pageIndex + 1} carries no text. A full-page figure is fine; a blank page from a stray break is not.`,
        suggestion:
          'Preview the page; remove the page break or the empty section if nothing was meant to be there.',
      })
    );
  });

  // -- Stranded heading (docx): the last body line on its page.
  if (format === 'docx') {
    for (const match of matches) {
      if (match.entry.role !== 'heading' || match.status !== 'mapped') continue;
      const o = match.occurrences[0];
      const part = o.parts[o.parts.length - 1];
      if (part.pageIndex >= pages.length - 1) continue;
      const page = pages[part.pageIndex];
      const below = page.words.some(
        (w, i) =>
          !chromeWords.has(`${part.pageIndex}:${i}`) &&
          !part.words.includes(i) &&
          w.yMin >= part.yMax - 1
      );
      if (below) continue;
      findings.push(
        finding({
          ruleId: 'rendered/heading-stranded',
          code: QUALITY_CODES.RENDERED_HEADING_STRANDED,
          category: 'composition',
          severity: 'warning',
          mapping: 'mapped',
          page: part.pageIndex + 1,
          path: match.entry.path,
          message: `Heading "${excerpt(match.entry.text)}" is the last line on page ${part.pageIndex + 1}; its content starts on the next page.`,
          suggestion:
            'Keep the heading with its first paragraph (keep-with-next), or move a page break so they land together.',
        })
      );
    }

    // -- Split paragraph: one line alone on either side of a page break.
    for (const match of matches) {
      const role = match.entry.role;
      if (
        (role !== 'body' && role !== 'list-item') ||
        match.status !== 'mapped'
      )
        continue;
      const o = match.occurrences[0];
      if (o.pageIndex === o.endPageIndex) continue;
      const first = o.parts[0];
      const last = o.parts[o.parts.length - 1];
      const linesOn = (part: OccurrencePart) => {
        const lines = lineOfWord(pages[part.pageIndex]);
        const set = new Set<number>();
        for (const w of part.words) {
          const line = lines.get(w);
          if (line !== undefined) set.add(line);
        }
        return set.size;
      };
      const before = linesOn(first);
      const after = linesOn(last);
      if (before === 0 || after === 0) continue;
      if (before > 1 && after > 1) continue;
      const which = before === 1 ? 'orphan' : 'widow';
      findings.push(
        finding({
          ruleId: 'rendered/paragraph-split',
          code: QUALITY_CODES.RENDERED_PARAGRAPH_SPLIT,
          category: 'composition',
          severity: 'info',
          mapping: 'mapped',
          page: (which === 'orphan' ? first.pageIndex : last.pageIndex) + 1,
          path: match.entry.path,
          message:
            which === 'orphan'
              ? `"${excerpt(match.entry.text)}" leaves one line alone at the foot of page ${first.pageIndex + 1}.`
              : `"${excerpt(match.entry.text)}" leaves one line alone at the top of page ${last.pageIndex + 1}.`,
          suggestion:
            'Edit the paragraph a few words shorter or longer, or set widow/orphan control on the style.',
          evidence: {
            summary: 'Lines on each side of the page break',
            values: { linesBefore: before, linesAfter: after },
          },
          context: { kind: which },
        })
      );
    }
  }

  const inventory: Record<MappingStatus, number> = {
    mapped: 0,
    ambiguous: 0,
    missing: 0,
    skipped: 0,
  };
  for (const match of matches) inventory[match.status] += 1;
  const byMapping: Record<RenderedMapping, number> = {
    mapped: 0,
    ambiguous: 0,
    unmapped: 0,
  };
  for (const f of findings) {
    byMapping[(f.context?.mapping as RenderedMapping) ?? 'unmapped'] += 1;
  }

  return {
    findings,
    summary: {
      pages: pages.length,
      words: pages.reduce((n, p) => n + p.words.length, 0),
      inventory,
      findings: byMapping,
      ...(input.fonts &&
        input.requestedFonts && {
          fonts: { requested: input.requestedFonts.length, substituted },
        }),
    },
  };
}
