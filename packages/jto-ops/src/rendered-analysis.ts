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
 *
 * The checks draft findings; the quality engine turns them into
 * diagnostics. Each check is one rule of `RENDERED_QUALITY_RULES`, so a
 * profile can switch one off or move its severity, a policy can suppress
 * one at a pointer and a gate can make one blocking — the same levers every
 * static rule answers to, applied to the pass that measures.
 */

import {
  QualityEngine,
  type QualityAnalysis,
  type QualityAnalyzeOptions,
  type QualityDiagnostic,
  type QualityFact,
  type QualityRuleFinding,
} from '@json-to-office/quality';
import type { PdfFontInfo } from './pdf-fonts';
import { familyRendered } from './pdf-fonts';
import type { PdfTextPage, PdfTextWord } from './pdf-text-geometry';
import { RENDERED_QUALITY_RULES, type RenderedRuleId } from './rendered-rules';
import {
  assignInventory,
  CHROME_BAND,
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
    | 'toc-entry'
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
  /** Renderer identity, for a profile that declares renderer targets. */
  renderer?: string;
  pages: readonly PdfTextPage[];
  inventory: readonly RenderedTextEntry[];
  /** Fonts the PDF carries; `undefined` when the host could not inspect them. */
  fonts?: readonly PdfFontInfo[];
  requestedFonts?: readonly RequestedFont[];
}

/**
 * Below this share of the body area painted, a page that is neither the
 * cover nor the last is under-filled. Judges called a page "two-thirds
 * blank" a defect and a page that ends at its midpoint acceptable, so the
 * line sits between.
 */
export const MINIMUM_PAGE_FILL = 0.5;

/**
 * The last page may end wherever the text ends; but a last page that holds
 * only the tail — the notes, a source line, one orphaned paragraph — is a
 * stub, and the judge names it as one. Below this share it is reported.
 */
export const MINIMUM_LAST_PAGE_FILL = 0.25;

/** How a finding reached its pointer — always on `context.mapping`. */
export type RenderedMapping = 'mapped' | 'ambiguous' | 'unmapped';

export interface RenderedAnalysisSummary {
  pages: number;
  words: number;
  /** Inventory entries by mapping outcome. */
  inventory: Record<MappingStatus, number>;
  /** Findings by mapping outcome, after suppressions. */
  findings: Record<RenderedMapping, number>;
  fonts?: { requested: number; substituted: number };
  /** Findings a policy suppression removed. */
  suppressed: number;
  /** Whether a policy gate made any finding blocking. */
  blocked: boolean;
  /** Whether a policy `maxDiagnostics` budget cut the findings returned. */
  truncated: boolean;
  /** The quality profile the pass ran under, when one applied. */
  profileId?: string;
}

export interface RenderedAnalysis {
  /** The pass's diagnostics, as the quality engine finalised them. */
  findings: readonly QualityDiagnostic[];
  summary: RenderedAnalysisSummary;
  /** The engine's own account: evaluated rules, rule errors, truncation. */
  analysis: QualityAnalysis;
}

/**
 * The checks' output before the engine: a rule finding with its rule id.
 * Code, category and default severity are the rule's, declared once in
 * `RENDERED_QUALITY_RULES`; a draft states a severity only where one rule
 * varies it per finding.
 */
export interface RenderedFindingDraft extends QualityRuleFinding {
  ruleId: RenderedRuleId;
  path: string;
}

export interface RenderedDraft {
  drafts: readonly RenderedFindingDraft[];
  /** The same drafts partitioned by rule, for the pack's `evaluate`. */
  byRule: ReadonlyMap<RenderedRuleId, readonly RenderedFindingDraft[]>;
  /** Inventory entries by mapping outcome. */
  inventory: Record<MappingStatus, number>;
  fonts?: { requested: number; substituted: number };
}

/** What the rules read: the whole input of the pass, as one fact. */
export interface RenderedGeometryFact extends QualityFact {
  kind: 'rendered/geometry';
  input: RenderedAnalysisInput;
}

export function isRenderedGeometryFact(
  fact: QualityFact
): fact is RenderedGeometryFact {
  return fact.kind === 'rendered/geometry';
}

const drafts = new WeakMap<RenderedGeometryFact, RenderedDraft>();

/** The pass's drafts for a fact, computed once and shared by every rule. */
export function renderedDraftFor(fact: RenderedGeometryFact): RenderedDraft {
  let draft = drafts.get(fact);
  if (!draft) {
    draft = draftRenderedFindings(fact.input);
    drafts.set(fact, draft);
  }
  return draft;
}

/** Spill below this is sub-visual: renderer rounding, descender fuzz. */
export const VISIBLE_SPILL_PT = 2;
/** Two words overlap when their intersection covers this much of the smaller. */
const OVERLAP_FRACTION = 0.3;

interface FindingDraft {
  ruleId: RenderedRuleId;
  /** Only for a rule whose severity varies per finding. */
  severity?: QualityRuleFinding['severity'];
  message: string;
  path: string;
  mapping: RenderedMapping;
  page?: number;
  suggestion?: string;
  relatedPaths?: string[];
  evidence?: QualityDiagnostic['evidence'];
  context?: Record<string, unknown>;
}

/**
 * A draft as the engine reads it. Every rendered finding carries its
 * mapping status and page on `context`, so one place decides that rather
 * than eight rules; severity and blocking are the engine's to settle.
 */
function finding(draft: FindingDraft): RenderedFindingDraft {
  const { mapping, page, context, ...rest } = draft;
  return {
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

/** Area the two word boxes share, in square points; 0 when they miss. */
function intersects(a: PdfTextWord, b: PdfTextWord): number {
  const w = Math.min(a.xMax, b.xMax) - Math.max(a.xMin, b.xMin);
  const h = Math.min(a.yMax, b.yMax) - Math.max(a.yMin, b.yMin);
  return w > 0 && h > 0 ? w * h : 0;
}

function area(w: PdfTextWord): number {
  return Math.max(0, w.xMax - w.xMin) * Math.max(0, w.yMax - w.yMin);
}

/** Text as a message can quote it: whitespace collapsed, length capped. */
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

/**
 * Run every check and return its drafts, ungated. `analyzeRenderedDocument`
 * is the entry point; the rule pack reads this through `renderedDraftFor`,
 * once per fact, so eight rules share one matching pass.
 */
function draftRenderedFindings(input: RenderedAnalysisInput): RenderedDraft {
  const { pages, format } = input;
  const { matches, chromeWords } = assignInventory(pages, input.inventory);
  const owners = wordOwners(matches);
  const findings: RenderedFindingDraft[] = [];

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

  // -- Empty pages: no body text. In docx the running head and footer repeat
  // on a stray page too, so chrome does not count as content there; a deck
  // declares no chrome inventory, so a slide with any word is not empty (an
  // image slide carrying its slide number is the legitimate case). A
  // full-page figure is legitimate, so this is information, not a warning.
  pages.forEach((page, pageIndex) => {
    const hasBody =
      format === 'docx'
        ? page.words.some((_, i) => !chromeWords.has(`${pageIndex}:${i}`))
        : page.words.length > 0;
    if (hasBody) return;
    const kind = page.words.length > 0 ? 'chrome-only' : 'blank';
    findings.push(
      finding({
        ruleId: 'rendered/empty-page',
        mapping: 'unmapped',
        page: pageIndex + 1,
        path: '',
        message: `Page ${pageIndex + 1} carries ${kind === 'chrome-only' ? 'only its running head or footer' : 'no text'}. A full-page figure is fine; a blank page from a stray break or an empty section is not.`,
        suggestion:
          'Preview the page; remove the page break or the empty section if nothing was meant to be there.',
        context: { kind },
      })
    );
  });

  // -- Under-filled page (docx): the ink stops well above the footer on a
  // page that is neither the cover nor the end, so a page break, not the
  // content, decided where the page ended. Ink, not words: a chart or a
  // table fills a page without a word the geometry can see.
  if (format === 'docx') {
    pages.forEach((page, pageIndex) => {
      if (!page.ink || pageIndex === 0) return;
      const last = pageIndex === pages.length - 1;
      const rowPt = page.heightPt / page.ink.rows;
      let headerBottom = 0;
      let footerTop = page.heightPt;
      page.words.forEach((w, i) => {
        if (!chromeWords.has(`${pageIndex}:${i}`)) return;
        if (w.yMax <= page.heightPt * CHROME_BAND) {
          headerBottom = Math.max(headerBottom, w.yMax);
        } else if (w.yMin >= page.heightPt * (1 - CHROME_BAND)) {
          footerTop = Math.min(footerTop, w.yMin);
        }
      });
      // Skip the row under the header text too: its hairline is chrome.
      const body = page.ink.inked.filter(
        (row) =>
          row * rowPt > headerBottom + rowPt && (row + 1) * rowPt < footerTop
      );
      if (body.length === 0) return; // the empty-page rule owns this page
      const top = body[0] * rowPt;
      const bottom = (body[body.length - 1] + 1) * rowPt;
      const fill = Math.round(((bottom - top) / (footerTop - top)) * 100) / 100;
      if (fill >= (last ? MINIMUM_LAST_PAGE_FILL : MINIMUM_PAGE_FILL)) return;
      // The section owning the page: the top-level child of the last body
      // text mapped onto it.
      let owner: { path: string; yMax: number } | undefined;
      for (const match of matches) {
        if (match.status !== 'mapped' || match.entry.repeats) continue;
        for (const o of match.occurrences) {
          // Every part on this page: a paragraph that starts here and runs
          // on still owns this page through the part it left behind.
          for (const part of o.parts) {
            if (part.pageIndex !== pageIndex) continue;
            if (!owner || part.yMax > owner.yMax) {
              owner = { path: match.entry.path, yMax: part.yMax };
            }
          }
        }
      }
      // A last page belongs to the section that closes the document, which
      // is not always the section its text was authored in: the notes are
      // painted from source slots the sections that cited them own, so the
      // text furthest down a stub last page names a section near the front.
      // The repair is a page break in the closing section, so that is the
      // pointer the finding carries — but only when the page mapped at all,
      // since `mapping` still says whether the words on it were owned.
      const owned = owner
        ? /^\/children\/\d+/.exec(owner.path)?.[0]
        : undefined;
      const section =
        owned && last ? closingSection(input.inventory) ?? owned : owned;
      findings.push(
        finding({
          ruleId: 'rendered/page-underfilled',
          mapping: section ? 'mapped' : 'unmapped',
          page: pageIndex + 1,
          path: section ?? '',
          message: last
            ? `Page ${pageIndex + 1}, the last, is ${Math.round(fill * 100)}% filled: only the tail of the document reached it.`
            : `Page ${pageIndex + 1} is ${Math.round(fill * 100)}% filled: its content stops ${Math.round(footerTop - bottom)}pt above the footer and the next page begins anyway.`,
          suggestion: last
            ? 'Set `pageBreak: true` on this section — or on the one before it, when this section already starts a page — so the closing argument and its notes share one designed page instead of the last page taking only their tail, then re-preview. Keeping the notes with the paragraph above them moves the tail, not the page.'
            : 'Merge this section into its neighbour, or give the page the table or chart its argument owes. Do not pad it with prose: a short section on its own page reads as unfinished, a padded one reads as filler.',
          evidence: {
            summary: 'Share of the body area the page paints, header to footer',
            expected: `≥ ${Math.round((last ? MINIMUM_LAST_PAGE_FILL : MINIMUM_PAGE_FILL) * 100)}%`,
            actual: fill,
          },
          context: { fill, kind: last ? 'last-page' : 'middle-page' },
        })
      );
    });
  }

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

    // -- Split table: the header alone at a page foot, or one row alone on
    // either side of the break. A table is grouped by its own pointer, and a
    // row by the index in the cell pointers the inventory wrote.
    // A cell pointer ends at the cell or inside it — `.../cells/2/content`
    // when the cell is an object rather than a bare string.
    const TABLE_CELL =
      /^(.*)\/props\/columns\/(\d+)\/(?:header|cells\/(\d+))(?:\/.*)?$/;
    const tables = new Map<
      string,
      {
        pages: Map<number, Set<number>>;
        paths: Map<number, { column: number; path: string }>;
      }
    >();
    for (const match of matches) {
      if (
        (match.entry.role !== 'table-header' &&
          match.entry.role !== 'table-cell') ||
        match.status !== 'mapped'
      )
        continue;
      const parsed = TABLE_CELL.exec(match.entry.path);
      if (!parsed) continue;
      const [, table, column, row] = parsed;
      // A header carries no row index; -1 orders it above every row.
      const rowIndex = row === undefined ? -1 : Number(row);
      const entry = tables.get(table) ?? {
        pages: new Map<number, Set<number>>(),
        paths: new Map<number, { column: number; path: string }>(),
      };
      for (const occurrence of match.occurrences)
        for (const part of occurrence.parts) {
          const rows = entry.pages.get(part.pageIndex) ?? new Set<number>();
          rows.add(rowIndex);
          entry.pages.set(part.pageIndex, rows);
        }
      // The row's leftmost cell, so a finding always lands on the same
      // pointer however the matcher happened to order the columns.
      const held = entry.paths.get(rowIndex);
      if (!held || Number(column) < held.column)
        entry.paths.set(rowIndex, {
          column: Number(column),
          path: match.entry.path,
        });
      tables.set(table, entry);
    }
    for (const [table, { pages: onPage, paths }] of tables) {
      const ordered = [...onPage.keys()].sort((a, b) => a - b);
      if (ordered.length < 2) continue;
      const bodyRows = (page: number) =>
        [...(onPage.get(page) ?? [])].filter((row) => row >= 0);
      const report = (
        kind: 'header-alone' | 'orphan-row' | 'widow-row',
        page: number,
        path: string,
        message: string,
        suggestion: string
      ) =>
        findings.push(
          finding({
            ruleId: 'rendered/table-split',
            mapping: 'mapped',
            page: page + 1,
            path,
            message,
            suggestion,
            context: { kind, table },
          })
        );
      const firstPage = ordered[0];
      const lastPage = ordered[ordered.length - 1];
      if (onPage.get(firstPage)!.has(-1) && bodyRows(firstPage).length === 0) {
        report(
          'header-alone',
          firstPage,
          paths.get(-1)!.path,
          `The table's header is the only part of it on page ${firstPage + 1}; its rows start on the next page.`,
          'Keep the header with its first rows, or move the table so it starts on the next page.'
        );
        continue;
      }
      const opening = bodyRows(firstPage);
      const closing = bodyRows(lastPage);
      if (opening.length === 1)
        report(
          'orphan-row',
          firstPage,
          paths.get(opening[0])!.path,
          `The table leaves one row alone at the foot of page ${firstPage + 1}.`,
          'Keep the table together on one page, or edit the rows above it so the break falls elsewhere.'
        );
      else if (closing.length === 1)
        report(
          'widow-row',
          lastPage,
          paths.get(closing[0])!.path,
          `The table leaves one row alone at the top of page ${lastPage + 1}.`,
          'Keep the table together on one page, or edit the rows above it so the break falls elsewhere.'
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

  const byRule = new Map<RenderedRuleId, RenderedFindingDraft[]>();
  for (const draft of findings) {
    const bucket = byRule.get(draft.ruleId);
    if (bucket) bucket.push(draft);
    else byRule.set(draft.ruleId, [draft]);
  }

  return {
    drafts: findings,
    byRule,
    inventory,
    // The same gate the check itself runs under: an empty font list
    // verified nothing, and must not read as "nothing was substituted".
    ...(input.fonts &&
      input.fonts.length > 0 &&
      input.requestedFonts && {
        fonts: { requested: input.requestedFonts.length, substituted },
      }),
  };
}

let engine: QualityEngine | undefined;

/** The pass's engine: the rendered rule pack, built once. */
function renderedEngine(): QualityEngine {
  engine ??= new QualityEngine(RENDERED_QUALITY_RULES.rules);
  return engine;
}

/**
 * The top-level section that closes the document: the highest `/children/n`
 * any authored string sits under. Read off the inventory because the
 * analysis never sees the document — the inventory is in document order and
 * every entry carries the pointer it was written at.
 */
function closingSection(
  inventory: readonly RenderedTextEntry[]
): string | undefined {
  let highest: number | undefined;
  for (const entry of inventory) {
    if (entry.repeats) continue;
    const index = /^\/children\/(\d+)/.exec(entry.path)?.[1];
    if (index === undefined) continue;
    const value = Number(index);
    if (highest === undefined || value > highest) highest = value;
  }
  return highest === undefined ? undefined : `/children/${highest}`;
}

/**
 * Run the pass. Geometry, fonts and inventory become one `rendered/geometry`
 * fact; the rendered rule pack reads it under the caller's profile and
 * policy, so the findings come back suppressed, re-severed and gated the
 * way `jto_validate`'s would.
 */
export function analyzeRenderedDocument(
  input: RenderedAnalysisInput,
  options: QualityAnalyzeOptions = {}
): RenderedAnalysis {
  const fact: RenderedGeometryFact = {
    id: 'rendered:geometry',
    kind: 'rendered/geometry',
    path: '',
    input,
  };
  const analysis = renderedEngine().analyzeSync(
    {
      format: input.format,
      model: undefined,
      facts: [fact],
      provenance: {},
      ...(input.renderer !== undefined && { renderer: input.renderer }),
    },
    options
  );
  // The rules met any fault in the measuring pass as a rule error; the
  // summary must not turn that into a crash of an advisory pass.
  let draft: RenderedDraft | undefined;
  try {
    draft = renderedDraftFor(fact);
  } catch {
    draft = undefined;
  }
  const byMapping: Record<RenderedMapping, number> = {
    mapped: 0,
    ambiguous: 0,
    unmapped: 0,
  };
  for (const f of analysis.diagnostics) {
    byMapping[(f.context?.mapping as RenderedMapping) ?? 'unmapped'] += 1;
  }
  return {
    findings: analysis.diagnostics,
    summary: {
      pages: input.pages.length,
      words: input.pages.reduce((n, p) => n + p.words.length, 0),
      inventory: draft?.inventory ?? {
        mapped: 0,
        ambiguous: 0,
        missing: 0,
        skipped: 0,
      },
      findings: byMapping,
      ...(draft?.fonts && { fonts: draft.fonts }),
      suppressed: analysis.suppressedCount,
      blocked: analysis.blocked,
      truncated: analysis.truncated,
      ...(analysis.profileId !== undefined && {
        profileId: analysis.profileId,
      }),
    },
    analysis,
  };
}
