import {
  chartInfoDesignFindings,
  DEFAULT_MAXIMUM_CHART_SERIES,
  DEFAULT_MAXIMUM_PIE_SLICES,
  fontCountFinding,
  mergeQualityProfiles,
  nearestPaletteToken,
  offPaletteFinding,
  placeholderFinding,
  QUALITY_CODES,
  QualityEngine,
  tableInfoDesignFindings,
  type JsonPatchOperation,
  type QualityProfile,
  type QualityRule,
  type QualityRulePack,
} from '@json-to-office/quality';
import type {
  DocxChartFact,
  DocxChromeSlotFact,
  DocxColorFact,
  DocxFontFact,
  DocxFrameTextFact,
  DocxHeadingFact,
  DocxLineBoxFact,
  DocxPlaceholderFact,
  DocxBlockSlotFact,
  DocxQualityFact,
  DocxQualityModel,
  DocxSectionChromeFact,
  DocxSvgTextFact,
  DocxTableColumnFact,
  DocxTableFact,
  DocxTableWidthFact,
  DocxThemeFact,
} from './facts';
import { estimateTextWidthPt, estimateWrappedLines } from './text-metrics';

/** Half a point: enough to absorb integer-twip rounding. */
const WIDTH_TOLERANCE_TWIPS = 10;

function numberParameter(
  parameters: Readonly<Record<string, unknown>>,
  name: string,
  fallback: number
): number {
  const value = parameters[name];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export const docxTableWidthRule: QualityRule<
  DocxQualityModel,
  DocxQualityFact
> = {
  id: 'docx/table-width',
  code: QUALITY_CODES.TABLE_WIDTH_OVERFLOW,
  category: 'integrity',
  defaultSeverity: 'warning',
  defaultCertainty: 'deterministic',
  formats: ['docx'],
  defaultParameters: { toleranceTwips: WIDTH_TOLERANCE_TWIPS },
  evaluate: ({ facts, configuration }) => {
    const toleranceTwips = numberParameter(
      configuration.parameters,
      'toleranceTwips',
      WIDTH_TOLERANCE_TWIPS
    );
    return facts
      .filter(
        (fact): fact is DocxTableWidthFact => fact.kind === 'docx/table-width'
      )
      .filter(
        (fact) =>
          fact.hasExplicitWidth &&
          fact.totalWidthTwips > fact.availableWidthTwips + toleranceTwips
      )
      .map((fact) => {
        const totalPt = Math.round((fact.totalWidthTwips / 20) * 10) / 10;
        const availablePt =
          Math.round((fact.availableWidthTwips / 20) * 10) / 10;
        // Deterministic repair: scale every explicit width by the overshoot
        // so proportions survive and the sum lands on the available width.
        const scale = fact.availableWidthTwips / fact.totalWidthTwips;
        const fixes = fact.allColumnsExplicit
          ? fact.explicitWidths.map(({ index, width }) => ({
              op: 'replace' as const,
              path: `${fact.path}/${index}/width`,
              value:
                typeof width === 'number'
                  ? Math.floor(width * scale * 10) / 10
                  : `${Math.floor(Number(width.trim().slice(0, -1)) * scale * 10) / 10}%`,
            }))
          : [];
        return {
          message: `Column widths use ${totalPt}pt, but this section has ${availablePt}pt available — the table will spill off the right edge.`,
          path: fact.path,
          suggestion:
            'Reduce fixed/percentage widths, widen the page, or leave columns unsized so they share the remainder.',
          context: {
            totalWidthPt: totalPt,
            availableWidthPt: availablePt,
            pointSum: fact.pointSum,
            percentSum: fact.percentSum,
          },
          evidence: {
            actual: totalPt,
            expected: availablePt,
            unit: 'pt',
          },
          ...(fixes.length > 0 && { fixes }),
        };
      });
  },
};

export const docxHeadingHierarchyRule: QualityRule<
  DocxQualityModel,
  DocxQualityFact
> = {
  id: 'docx/heading-hierarchy',
  code: QUALITY_CODES.HEADING_SKIP,
  category: 'hierarchy',
  defaultSeverity: 'info',
  defaultCertainty: 'deterministic',
  formats: ['docx'],
  evaluate: ({ facts }) =>
    facts
      .filter((fact): fact is DocxHeadingFact => fact.kind === 'docx/heading')
      .flatMap((fact) => {
        const previousLevel = fact.previousLevel;
        if (previousLevel === undefined || fact.level <= previousLevel + 1) {
          return [];
        }
        return [
          {
            message: `Heading level ${fact.level} follows level ${previousLevel} — the skipped level breaks the document outline.`,
            path: fact.path,
            suggestion: `Use level ${previousLevel + 1}, or promote this heading's section.`,
            context: { level: fact.level, previousLevel },
            evidence: {
              actual: fact.level,
              expected: previousLevel + 1,
            },
            // The fact path already addresses `.../props/level`; RFC 6902
            // `add` replaces an existing member, so this works whether the
            // level was explicit or defaulted.
            fixes: [
              {
                op: 'add' as const,
                path: fact.path,
                value: previousLevel + 1,
              },
            ],
          },
        ];
      }),
};

/**
 * How far past a box the width model must land before the rule speaks.
 *
 * `estimateTextWidthPt` sits within roughly 8% of rendered geometry, so an
 * overflow inside that band is indistinguishable from a fit. Firing there would
 * trade real defects for noise on every template that merely sets tight type.
 * The band is the honest limit of a static model: catching a 3% overrun needs
 * measured glyph positions, which is the rendered-certainty pass, not this rule.
 */
const WIDTH_MODEL_TOLERANCE = 1.08;
const TWIPS_PER_POINT = 20;

function frameTextFacts(
  facts: readonly DocxQualityFact[]
): DocxFrameTextFact[] {
  return facts.filter(
    (fact): fact is DocxFrameTextFact => fact.kind === 'docx/frame-text'
  );
}

export const docxTextFitRule: QualityRule<DocxQualityModel, DocxQualityFact> = {
  id: 'docx/text-fit',
  code: QUALITY_CODES.TEXT_OVERFLOW,
  category: 'integrity',
  defaultSeverity: 'warning',
  defaultCertainty: 'estimated',
  formats: ['docx'],
  defaultParameters: { widthTolerance: WIDTH_MODEL_TOLERANCE },
  evaluate: ({ facts, configuration }) => {
    const tolerance = numberParameter(
      configuration.parameters,
      'widthTolerance',
      WIDTH_MODEL_TOLERANCE
    );
    const findings = [];

    for (const fact of frameTextFacts(facts)) {
      const frameWidthPt = fact.frameWidthTwips / TWIPS_PER_POINT;

      // A word wider than its frame has nowhere to wrap, so the renderer breaks
      // it mid-word. Unlike a paragraph that merely runs long, the damage lands
      // inside a single word.
      const longestWordPt = estimateTextWidthPt(
        fact.longestWord,
        fact.fontSizePt,
        fact.characterSpacingPt
      );
      if (longestWordPt > frameWidthPt * tolerance) {
        findings.push({
          message: `"${fact.longestWord}" is estimated at ${Math.round(longestWordPt)}pt in a ${Math.round(frameWidthPt)}pt frame — with no wrap point it will break mid-word.`,
          path: `${fact.path}/props/floating/width`,
          suggestion:
            'Widen the frame, reduce fontSize, or condense the run further.',
          context: {
            longestWord: fact.longestWord,
            estimatedWidthPt: Math.round(longestWordPt),
            frameWidthPt: Math.round(frameWidthPt),
            fontSizePt: fact.fontSizePt,
          },
          evidence: {
            actual: Math.round(longestWordPt),
            expected: Math.round(frameWidthPt),
            unit: 'pt',
          },
        });
        continue;
      }

      // A frame pinned near the foot of the page takes its wrapped height with
      // it. When that runs past the last usable twip the overflow does not
      // clip — it repaginates, and a heading arrives split across two pages.
      if (fact.offsetYTwips === undefined) continue;
      const lines = estimateWrappedLines(
        fact.text,
        frameWidthPt,
        fact.fontSizePt,
        fact.characterSpacingPt
      );
      const heightTwips = lines * fact.lineHeightPt * TWIPS_PER_POINT;
      const bottomTwips = fact.offsetYTwips + heightTwips;
      // The line count inherits the width model's error, so an overrun smaller
      // than one line is inside the noise — a 143-twip "overflow" on the stock
      // annual report turned out to start and finish on the same page. Only an
      // overrun that actually costs a line is worth a warning.
      const overrunTwips = bottomTwips - fact.pageBottomTwips;
      if (overrunTwips <= fact.lineHeightPt * TWIPS_PER_POINT) continue;

      findings.push({
        message: `Frame starts at ${fact.offsetYTwips} twips and needs ${Math.round(heightTwips)} more for ${lines} line${lines === 1 ? '' : 's'} of ${fact.fontSizePt}pt — it runs ${Math.round(overrunTwips)} twips past the page, so the text breaks onto the next one.`,
        path: `${fact.path}/props/floating/verticalPosition/offset`,
        suggestion:
          'Raise the frame, shorten the text, or reduce fontSize so the block finishes on the page.',
        context: {
          offsetYTwips: fact.offsetYTwips,
          estimatedHeightTwips: Math.round(heightTwips),
          pageBottomTwips: fact.pageBottomTwips,
          lines,
        },
        evidence: {
          actual: Math.round(bottomTwips),
          expected: fact.pageBottomTwips,
          unit: 'twips',
        },
      });
    }

    return findings;
  },
};

/**
 * Below this much shared width, two frames are read as clear of each other.
 * Authored x/width are exact twips, so a narrower intersection is a real
 * sliver of frame — but text rarely reaches its own frame edge (ragged right,
 * plus the width model's error runs both ways), and the stock corpus places
 * frames whose boxes brush by up to ~130 twips while their text never
 * touches. 240 twips (12pt) keeps a margin above the widest observed brush.
 */
const FRAME_COLLISION_MIN_WIDTH_TWIPS = 240;

/** One estimated frame: an OOXML frame chain reduced to its page rect. */
interface FrameRect {
  /** The chain's anchor paragraph — the frame's authored identity. */
  path: string;
  offsetYAuthored: boolean;
  x: number;
  y: number;
  widthTwips: number;
  heightTwips: number;
  /**
   * The tallest member line in twips: one line of it is the height
   * estimate's own error, so overlaps inside it are indistinguishable from a
   * clean layout — and display type banks on exactly that slack, tucking a
   * caption inside a stat digit's nominal line box.
   */
  lineTwips: number;
  groupKey: string;
}

export const docxFrameCollisionRule: QualityRule<
  DocxQualityModel,
  DocxQualityFact
> = {
  id: 'docx/frame-collision',
  code: QUALITY_CODES.FRAME_COLLISION,
  category: 'integrity',
  defaultSeverity: 'warning',
  defaultCertainty: 'estimated',
  formats: ['docx'],
  defaultParameters: {
    minOverlapWidthTwips: FRAME_COLLISION_MIN_WIDTH_TWIPS,
    minOverlapLines: 1,
  },
  evaluate: ({ facts, configuration }) => {
    const minOverlapWidthTwips = numberParameter(
      configuration.parameters,
      'minOverlapWidthTwips',
      FRAME_COLLISION_MIN_WIDTH_TWIPS
    );
    const minOverlapLines = numberParameter(
      configuration.parameters,
      'minOverlapLines',
      1
    );

    // Consecutive identical-geometry paragraphs are one OOXML frame: their
    // texts flow and stack inside a shared box, so the chain collapses to a
    // single rect whose height is the sum of its members. A member with no
    // fact (no authored font size) contributes no height — an underestimate,
    // which only ever keeps the rule quieter.
    const chains = new Map<string, FrameRect>();
    for (const fact of frameTextFacts(facts)) {
      // A `text`-relative origin moves with the frame's own anchor paragraph,
      // so two such frames can share a group key without sharing a coordinate
      // origin. Only the fixed origins — `page` and `margin` — compare.
      if (
        !fact.absoluteOffsetTwips ||
        fact.anchorHorizontal === 'text' ||
        fact.anchorVertical === 'text'
      ) {
        continue;
      }
      const lines = estimateWrappedLines(
        fact.text,
        fact.frameWidthTwips / TWIPS_PER_POINT,
        fact.fontSizePt,
        fact.characterSpacingPt
      );
      const heightTwips = lines * fact.lineHeightPt * TWIPS_PER_POINT;
      const lineTwips = fact.lineHeightPt * TWIPS_PER_POINT;
      const chain = chains.get(fact.frameChainId);
      if (chain) {
        chain.heightTwips += heightTwips;
        chain.lineTwips = Math.max(chain.lineTwips, lineTwips);
        continue;
      }
      chains.set(fact.frameChainId, {
        path: fact.path,
        offsetYAuthored: fact.offsetYTwips !== undefined,
        x: fact.absoluteOffsetTwips.x,
        y: fact.absoluteOffsetTwips.y,
        widthTwips: fact.frameWidthTwips,
        heightTwips,
        lineTwips,
        // Offsets only compare within one page flow and one anchor pair.
        groupKey: `${fact.flowIndex}:${fact.anchorHorizontal}:${fact.anchorVertical}`,
      });
    }

    const groups = new Map<string, FrameRect[]>();
    for (const chain of chains.values()) {
      const group = groups.get(chain.groupKey);
      if (group) group.push(chain);
      else groups.set(chain.groupKey, [chain]);
    }

    const findings = [];
    for (const group of groups.values()) {
      for (let i = 0; i < group.length; i += 1) {
        for (let j = i + 1; j < group.length; j += 1) {
          const a = group[i];
          const b = group[j];
          const overlapWidth =
            Math.min(a.x + a.widthTwips, b.x + b.widthTwips) -
            Math.max(a.x, b.x);
          if (overlapWidth <= minOverlapWidthTwips) continue;
          const overlapHeight =
            Math.min(a.y + a.heightTwips, b.y + b.heightTwips) -
            Math.max(a.y, b.y);
          // The height estimates inherit the width model's error
          // (WIDTH_MODEL_TOLERANCE): each rect's bottom is uncertain by about
          // one of its own lines, so an overlap inside the taller line is
          // noise — and legitimate layouts spend that slack, tucking captions
          // into a display digit's nominal line box.
          const floorTwips =
            Math.max(a.lineTwips, b.lineTwips) * minOverlapLines;
          if (overlapHeight <= floorTwips) continue;

          const overlapHeightPt = Math.round(overlapHeight / TWIPS_PER_POINT);
          const overlapWidthPt = Math.round(overlapWidth / TWIPS_PER_POINT);
          findings.push({
            message: `This floating frame and an earlier one on the same page overlap by an estimated ${overlapHeightPt}pt of text across ${overlapWidthPt}pt of width — the two blocks paint on top of each other.`,
            path: b.offsetYAuthored
              ? `${b.path}/props/floating/verticalPosition/offset`
              : `${b.path}/props/floating`,
            suggestion:
              'Move one frame, shorten its text, or reduce fontSize until the blocks clear each other.',
            context: {
              partnerPath: a.path,
              overlapWidthTwips: Math.round(overlapWidth),
              overlapHeightTwips: Math.round(overlapHeight),
              frameTopTwips: b.y,
              partnerTopTwips: a.y,
            },
            relatedPaths: [a.path],
            evidence: {
              actual: Math.round(overlapHeight),
              expected: Math.round(floorTwips),
              unit: 'twips',
            },
          });
        }
      }
    }
    return findings;
  },
};

export const docxSvgTextBoundsRule: QualityRule<
  DocxQualityModel,
  DocxQualityFact
> = {
  id: 'docx/svg-text-bounds',
  code: QUALITY_CODES.SVG_TEXT_CLIPPED,
  category: 'integrity',
  defaultSeverity: 'warning',
  defaultCertainty: 'deterministic',
  formats: ['docx'],
  evaluate: ({ facts }) =>
    facts
      .filter((fact): fact is DocxSvgTextFact => fact.kind === 'docx/svg-text')
      .flatMap((fact) => {
        const canvasBottom = fact.viewBoxMinY + fact.viewBoxHeight;
        // The baseline is the last thing that must land inside the canvas;
        // descenders below it are a rendering nicety, the baseline is the
        // difference between painted and gone.
        if (fact.baselineY <= canvasBottom) return [];
        const overflow = Math.round((fact.baselineY - canvasBottom) * 10) / 10;
        return [
          {
            message: `SVG text "${fact.content}" sits ${overflow} units below the viewBox — it is clipped away and never reaches the document's text layer.`,
            path: fact.path,
            suggestion: `Move the baseline above ${Math.round(canvasBottom)}, or grow the viewBox height.`,
            context: {
              content: fact.content,
              baselineY: fact.baselineY,
              canvasBottom,
              overflowUnits: overflow,
            },
            evidence: {
              actual: fact.baselineY,
              expected: canvasBottom,
              unit: 'viewBox units',
            },
          },
        ];
      }),
};

/**
 * Cap height as a fraction of the em — the point below which an exact line box
 * starts eating the capitals of the line it holds.
 *
 * `font.size` is floored at 8pt because type below it cannot be read; the same
 * reasoning applies to the box the glyphs sit in, except that the box has no
 * absolute floor to give it. An empty spacer paragraph legitimately pins 2pt,
 * and display type legitimately pins less than the font size: the tightest
 * exact box in the reference corpus is 10pt on 12pt type (0.83), and 0.95 is
 * routine. So the floor is relative, and it sits at cap height — 0.716 em on
 * Arial and Helvetica, 0.727 on Inter, 0.70 on Poppins and DM Sans. Below it
 * the ink of the very line the box holds is cut off, in any face.
 */
const LINE_BOX_MIN_RATIO = 0.7;

/** Points, to one decimal — enough for a line box, and stable to print. */
function tenths(value: number): number {
  return Math.round(value * 10) / 10;
}

export const docxLineBoxRule: QualityRule<DocxQualityModel, DocxQualityFact> = {
  id: 'docx/line-box',
  code: QUALITY_CODES.LINE_BOX_COLLAPSE,
  category: 'legibility',
  defaultSeverity: 'warning',
  defaultCertainty: 'measured',
  formats: ['docx'],
  defaultParameters: { minimumLineBoxRatio: LINE_BOX_MIN_RATIO },
  evaluate: ({ facts, configuration }) => {
    const ratio = numberParameter(
      configuration.parameters,
      'minimumLineBoxRatio',
      LINE_BOX_MIN_RATIO
    );
    return facts
      .filter((fact): fact is DocxLineBoxFact => fact.kind === 'docx/line-box')
      .flatMap((fact) => {
        const floorPt = Math.ceil(fact.fontSizePt * ratio * 10) / 10;
        if (fact.lineBoxPt >= floorPt) return [];
        // The floor says where the geometry is indefensible; the repair has to
        // land somewhere that renders. One em is the first box holding the
        // type's full nominal extent, and rendered 8pt body copy agrees:
        // stacked lines still touch at 0.7 and 0.8 em, clear at 0.9, and are
        // clean at 1.0. A profile is free to set a floor above one em, and a
        // repair that lands under its own floor would just fire again.
        const repairPt = Math.max(tenths(fact.fontSizePt), floorPt);
        const inherited = fact.fontSizeAuthored
          ? ''
          : ' inherited from the paragraph style';
        return [
          {
            message: `An exact ${tenths(fact.lineBoxPt)}pt line box holds ${tenths(fact.fontSizePt)}pt text${inherited} — shorter than the capitals it contains, so the lines overlap or lose their tops.`,
            path: fact.path,
            // The second sentence is the exit from the incentive that
            // produced this geometry: the reported route to a 3pt line was a
            // collapsed line box on 8pt type, because nothing else drew one.
            suggestion: `Set the box to at least ${repairPt}pt — as tall as the type it holds — or use "atLeast" so the line grows to fit the text. To draw a line rather than set leading, use the "divider" component.${fact.patchable ? '' : ' This box is not stated on the component: it arrives through `componentDefaults` and has to be repaired there.'}`,
            context: {
              lineBoxPt: tenths(fact.lineBoxPt),
              fontSizePt: tenths(fact.fontSizePt),
              capHeightFloorPt: floorPt,
            },
            evidence: {
              actual: tenths(fact.lineBoxPt),
              expected: floorPt,
              unit: 'pt',
            },
            // Only when the pointer exists in the authored document: a box
            // arriving through `componentDefaults` has to be repaired there.
            ...(fact.patchable && {
              fixes: [
                {
                  op: 'add' as const,
                  path: `${fact.path}/value`,
                  value: repairPt,
                },
              ],
            }),
          },
        ];
      });
  },
};

/**
 * Unfilled slots and leftover filler, in one rule over two codes.
 *
 * One rule because it is one question — "is this text real yet?" — and two
 * codes because the answers differ in consequence: a scaffold marker blocks
 * generation, filler only advises.
 */
export const docxPlaceholderRule: QualityRule<
  DocxQualityModel,
  DocxQualityFact
> = {
  id: 'docx/placeholder-text',
  code: QUALITY_CODES.PLACEHOLDER_TEXT,
  category: 'integrity',
  defaultSeverity: 'warning',
  defaultCertainty: 'deterministic',
  formats: ['docx'],
  evaluate: ({ facts }) =>
    facts
      .filter(
        (fact): fact is DocxPlaceholderFact => fact.kind === 'docx/placeholder'
      )
      .map((fact) =>
        placeholderFinding({
          path: fact.path,
          kind: fact.placeholderKind,
          pattern: fact.pattern,
          excerpt: fact.excerpt,
        })
      ),
};

/**
 * A block slot holds a bounded amount of text, and the bound is the block's,
 * not the theme's: a takeaway is one claim in one sentence whatever it is set
 * in. Reported at the authored slot, so the repair is a rewrite of that item.
 */
export const docxSlotBudgetRule: QualityRule<
  DocxQualityModel,
  DocxQualityFact
> = {
  id: 'docx/slot-budget',
  code: QUALITY_CODES.SLOT_BUDGET,
  category: 'composition',
  defaultSeverity: 'warning',
  defaultCertainty: 'deterministic',
  formats: ['docx'],
  evaluate: ({ facts }) =>
    facts
      .filter(
        (fact): fact is DocxBlockSlotFact => fact.kind === 'docx/block-slot'
      )
      .filter((fact) => fact.words > fact.maxWords)
      .map((fact) => ({
        path: fact.path,
        message:
          `${fact.block} ${fact.slot} entry runs to ${fact.words} words; the slot holds ` +
          `${fact.maxWords} — one claim, one sentence.`,
        suggestion:
          'Cut it to the conclusion. Move the evidence into the body it summarises.',
        evidence: {
          summary: 'words in the slot against its budget',
          actual: fact.words,
          expected: fact.maxWords,
          unit: 'words',
        },
        context: { block: fact.block, slot: fact.slot },
      })),
};

const DEFAULT_MAX_FONT_FAMILIES = 3;

/** Every family the document can paint: the theme's roles plus authored ones. */
export const docxFontCountRule: QualityRule<DocxQualityModel, DocxQualityFact> =
  {
    id: 'docx/font-count',
    code: QUALITY_CODES.FONT_COUNT,
    category: 'brand',
    defaultSeverity: 'warning',
    defaultCertainty: 'deterministic',
    formats: ['docx'],
    defaultParameters: { maximumFamilies: DEFAULT_MAX_FONT_FAMILIES },
    evaluate: ({ facts, configuration }) => {
      const maximum = numberParameter(
        configuration.parameters,
        'maximumFamilies',
        DEFAULT_MAX_FONT_FAMILIES
      );
      const theme = facts.find(
        (fact): fact is DocxThemeFact => fact.kind === 'docx/theme'
      );
      const families = new Set<string>(theme?.fontFamilies ?? []);
      const extraPaths: string[] = [];
      for (const fact of facts) {
        if (fact.kind !== 'docx/font-family') continue;
        const use = fact as DocxFontFact;
        if (!families.has(use.family)) extraPaths.push(use.path);
        families.add(use.family);
      }
      if (families.size <= maximum) return [];
      return [
        fontCountFinding({
          path: theme?.path ?? '/props',
          families: [...families].sort(),
          maximum,
          relatedPaths: [...new Set(extraPaths)],
        }),
      ];
    },
  };

/** A literal colour the resolved theme does not define. */
export const docxPaletteRule: QualityRule<DocxQualityModel, DocxQualityFact> = {
  id: 'docx/palette-adherence',
  code: QUALITY_CODES.OFF_PALETTE,
  category: 'brand',
  defaultSeverity: 'info',
  defaultCertainty: 'deterministic',
  formats: ['docx'],
  evaluate: ({ facts }) => {
    const theme = facts.find(
      (fact): fact is DocxThemeFact => fact.kind === 'docx/theme'
    );
    const palette = theme?.paletteHexes ?? {};
    const known = new Set(Object.values(palette));
    return facts
      .filter((fact): fact is DocxColorFact => fact.kind === 'docx/color')
      .filter((fact) => !known.has(fact.hex))
      .map((fact) => {
        const nearest = nearestPaletteToken(fact.hex, palette);
        return offPaletteFinding({
          path: fact.path,
          raw: fact.raw,
          hex: fact.hex,
          ...(nearest && { nearest }),
        });
      });
  },
};

/**
 * Rows past which a table stops being something a reader takes in and starts
 * being a data set stored in a document. A page holds far more than this; the
 * limit is about attention rather than about paper, which is why it advises
 * rather than warns.
 */
const DEFAULT_MAX_TABLE_ROWS_PER_PAGE = 25;

/** Information design for charts: the comparison, the palette and the caption. */
export const docxChartRule: QualityRule<DocxQualityModel, DocxQualityFact> = {
  id: 'docx/chart-design',
  code: QUALITY_CODES.CHART_OVERLOADED,
  category: 'information-design',
  defaultSeverity: 'warning',
  defaultCertainty: 'deterministic',
  formats: ['docx'],
  defaultParameters: {
    maximumSeries: DEFAULT_MAXIMUM_CHART_SERIES,
    maximumSlices: DEFAULT_MAXIMUM_PIE_SLICES,
  },
  evaluate: ({ facts, configuration }) => {
    const maximumSeries = numberParameter(
      configuration.parameters,
      'maximumSeries',
      DEFAULT_MAXIMUM_CHART_SERIES
    );
    const maximumSlices = numberParameter(
      configuration.parameters,
      'maximumSlices',
      DEFAULT_MAXIMUM_PIE_SLICES
    );
    return facts
      .filter((fact): fact is DocxChartFact => fact.kind === 'docx/chart')
      .flatMap((fact) => {
        const fix = seriesColorFix(fact);
        return chartInfoDesignFindings(fact, {
          maximumSeries,
          maximumSlices,
          ...(fix && { seriesColorFix: fix }),
        });
      });
  },
};

/**
 * The palette patch, when the theme has enough slots to draw every series.
 *
 * Only for a native chart: a Highcharts palette lives inside an options blob
 * the schema keeps opaque and the export server reads verbatim, so writing
 * into it means guessing at a structure this pass never validated.
 */
function seriesColorFix(
  fact: DocxChartFact
): readonly JsonPatchOperation[] | undefined {
  if (fact.componentName !== 'chart' || fact.generated) return undefined;
  if (fact.seriesCount < 1 || fact.paletteTokens.length === 0) return undefined;
  const tokens = Array.from(
    { length: fact.seriesCount },
    (_, index) => fact.paletteTokens[index % fact.paletteTokens.length]
  );
  return [{ op: 'add', path: fact.seriesColorsPath, value: tokens }];
}

/** Information design for tables: alignment, rounding, rules and length. */
export const docxTableDesignRule: QualityRule<
  DocxQualityModel,
  DocxQualityFact
> = {
  id: 'docx/table-design',
  code: QUALITY_CODES.TABLE_NUMERIC_ALIGN,
  category: 'information-design',
  defaultSeverity: 'warning',
  defaultCertainty: 'deterministic',
  formats: ['docx'],
  defaultParameters: { maximumRows: DEFAULT_MAX_TABLE_ROWS_PER_PAGE },
  evaluate: ({ facts, configuration }) => {
    const maximumRows = numberParameter(
      configuration.parameters,
      'maximumRows',
      DEFAULT_MAX_TABLE_ROWS_PER_PAGE
    );
    return facts
      .filter((fact): fact is DocxTableFact => fact.kind === 'docx/table')
      .flatMap((fact) =>
        tableInfoDesignFindings(fact, {
          maximumRows,
          rowSurface: 'page',
          rowSeverity: 'info',
          alignFix: alignColumnRight,
        })
      );
  },
};

/**
 * Right-align one column, header included.
 *
 * A column-major table has a column to patch, so the body is one operation.
 * The header takes its own, since `headerCellDefaults` outranks the column
 * for header cells, and any cell that stated an alignment of its own outranks
 * everything — a fix that left those behind would not clear its own finding.
 */
function alignColumnRight(
  column: DocxTableColumnFact
): readonly JsonPatchOperation[] {
  // A column a block compiled has nothing of its own to patch; the finding
  // points at the slot, and the definition is where alignment is decided.
  if (column.generated) return [];
  const operations: JsonPatchOperation[] = [
    column.hasCellDefaults
      ? {
          op: 'add',
          path: `${column.path}/cellDefaults/horizontalAlignment`,
          value: 'right',
        }
      : {
          op: 'add',
          path: `${column.path}/cellDefaults`,
          value: { horizontalAlignment: 'right' },
        },
  ];
  if (column.hasHeader) {
    operations.push({
      op: 'add',
      path: `${column.path}/header/horizontalAlignment`,
      value: 'right',
    });
  }
  for (const index of column.cellsWithOwnAlignment) {
    operations.push({
      op: 'add',
      path: `${column.path}/cells/${index}/horizontalAlignment`,
      value: 'right',
    });
  }
  return operations;
}

function stringListParameter(
  parameters: Readonly<Record<string, unknown>>,
  name: string
): string[] {
  const value = parameters[name];
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : [];
}

/**
 * Chrome a profile requires, judged where the block declared the slot. Off by
 * default: a takeaway under a chart or a source under a table is an archetype
 * convention, and the theme that styles the slot never asks for it.
 */
export const docxRequiredChromeRule: QualityRule<
  DocxQualityModel,
  DocxQualityFact
> = {
  id: 'docx/required-chrome',
  code: QUALITY_CODES.CHROME_MISSING,
  category: 'consistency',
  defaultSeverity: 'warning',
  defaultCertainty: 'deterministic',
  formats: ['docx'],
  defaultParameters: { required: [] },
  evaluate: ({ facts, configuration, profile }) => {
    const required = stringListParameter(configuration.parameters, 'required');
    if (required.length === 0) return [];
    return facts
      .filter(
        (fact): fact is DocxChromeSlotFact => fact.kind === 'docx/chrome-slot'
      )
      .filter((fact) => required.includes(fact.role) && !fact.present)
      .map((fact) => ({
        path: fact.path,
        relatedPaths: [fact.invocation],
        message:
          `${fact.block} states no ${fact.role} in its "${fact.slot}" slot; ` +
          `the ${profile?.id ?? 'selected'} profile expects one on every ${fact.block}.`,
        suggestion: `Fill the "${fact.slot}" slot. The theme already styles it.`,
        context: { block: fact.block, slot: fact.slot, role: fact.role },
      }));
  },
};

const SECTION_CHROME_PARTS = ['header', 'footer', 'pageNumber'] as const;

/**
 * A running head where the profile expects one: every top-level section from
 * `fromSection` on must carry the parts in `required` — a header, a footer,
 * a page-number field in either. The first section is exempt by default, so
 * a cover stays clean. Off by default; the theme only paints a running head.
 */
export const docxRunningHeadRule: QualityRule<
  DocxQualityModel,
  DocxQualityFact
> = {
  id: 'docx/running-head',
  code: QUALITY_CODES.CHROME_MISSING,
  category: 'consistency',
  defaultSeverity: 'warning',
  defaultCertainty: 'deterministic',
  formats: ['docx'],
  defaultParameters: { required: [], fromSection: 1 },
  evaluate: ({ facts, configuration, profile }) => {
    const required = stringListParameter(
      configuration.parameters,
      'required'
    ).filter((part): part is (typeof SECTION_CHROME_PARTS)[number] =>
      (SECTION_CHROME_PARTS as readonly string[]).includes(part)
    );
    if (required.length === 0) return [];
    const from = numberParameter(configuration.parameters, 'fromSection', 1);
    return facts
      .filter(
        (fact): fact is DocxSectionChromeFact =>
          fact.kind === 'docx/section-chrome' && fact.index >= from
      )
      .flatMap((fact) => {
        const missing = required.filter((part) => !fact[part]);
        if (missing.length === 0) return [];
        const parts = missing
          .map((part) => (part === 'pageNumber' ? 'page-number field' : part))
          .join(', ');
        return [
          {
            path: fact.path,
            message:
              `Section ${fact.index + 1} carries no ${parts}; the ` +
              `${profile?.id ?? 'selected'} profile expects a running head ` +
              `on every section after the cover.`,
            suggestion:
              'Invoke a running-head block at the top of the first body section: its section effect fills every later section with the tracker and n / N.',
            context: { section: fact.index, missing },
          },
        ];
      });
  },
};

export const DOCX_QUALITY_RULES: QualityRulePack<
  DocxQualityModel,
  DocxQualityFact
> = {
  id: 'docx/default',
  rules: [
    docxTableWidthRule,
    docxHeadingHierarchyRule,
    docxTextFitRule,
    docxFrameCollisionRule,
    docxSvgTextBoundsRule,
    docxLineBoxRule,
    docxPlaceholderRule,
    docxSlotBudgetRule,
    docxChartRule,
    docxTableDesignRule,
    docxFontCountRule,
    docxPaletteRule,
    docxRequiredChromeRule,
    docxRunningHeadRule,
  ],
};

export const DOCX_QUALITY_PROFILES = {
  'client-report': {
    id: 'client-report',
    formats: ['docx'],
    description:
      'Client or public-administration report: a running head with page numbers on every section after the cover, a takeaway and a source wherever a block declares them, no heading skipped.',
    rules: {
      'docx/required-chrome': {
        parameters: { required: ['takeaway', 'source'] },
      },
      'docx/running-head': {
        parameters: {
          required: ['header', 'footer', 'pageNumber'],
          fromSection: 1,
        },
      },
      'docx/heading-hierarchy': { severity: 'warning' },
    },
  },
  'executive-report': {
    id: 'executive-report',
    formats: ['docx'],
    description: 'Short decision document with strict outline continuity.',
    rules: {
      'docx/heading-hierarchy': { severity: 'warning' },
    },
  },
  'technical-report': {
    id: 'technical-report',
    formats: ['docx'],
    description: 'Portable professional report defaults.',
  },
  'legal-appendix': {
    id: 'legal-appendix',
    formats: ['docx'],
    description: 'Dense appendix: preserve integrity without editorial taste.',
  },
} as const satisfies Record<string, QualityProfile>;

export const DOCX_DEFAULT_QUALITY_PROFILE: QualityProfile =
  DOCX_QUALITY_PROFILES['technical-report'];

const DOCX_PROFILES_BY_ID: Readonly<Record<string, QualityProfile>> =
  DOCX_QUALITY_PROFILES;

/**
 * The shipped profile a document names in `props.qualityProfile`, so that
 * validation without arguments judges a blueprint scaffold by its archetype.
 * An unknown name is nobody's profile: the format default applies.
 */
export function declaredDocxQualityProfile(
  document: unknown
): QualityProfile | undefined {
  const props = (document as { props?: { qualityProfile?: unknown } })?.props;
  const id = props?.qualityProfile;
  return typeof id === 'string' ? DOCX_PROFILES_BY_ID[id] : undefined;
}

/**
 * Callers name a shipped profile by id — `{ id: 'executive-report', formats: ['docx'] }`.
 * Without this lookup that request reaches the engine carrying nothing but its id,
 * so the analysis runs on defaults while stamping the requested profileId.
 */
export function resolveDocxQualityProfile(
  requested: QualityProfile | undefined
): QualityProfile | undefined {
  if (!requested) return undefined;
  const registered = DOCX_PROFILES_BY_ID[requested.id];
  if (!registered) return requested;
  return mergeQualityProfiles(registered, requested);
}

export const docxQualityEngine = new QualityEngine(DOCX_QUALITY_RULES.rules);
