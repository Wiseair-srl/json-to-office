import {
  chartInfoDesignFindings,
  DEFAULT_MAXIMUM_CHART_SERIES,
  DEFAULT_MAXIMUM_PIE_SLICES,
  fontCountFinding,
  mergeQualityProfiles,
  nearestPaletteToken,
  offPaletteFinding,
  placeholderFinding,
  DEFAULT_IMAGE_ASPECT_TOLERANCE,
  driftingSizes,
  imageAspectFinding,
  offScaleFindings,
  QUALITY_CODES,
  roleDriftFindings,
  sizeCountFinding,
  type PaintedSize,
  type TypeVocabulary,
  QualityEngine,
  tableInfoDesignFindings,
  type JsonPatchOperation,
  type QualityProfile,
  type QualityRule,
  type QualityRuleFinding,
  type QualityRulePack,
} from '@json-to-office/quality';
import type {
  DocxChartFact,
  DocxChromeSlotFact,
  DocxColorFact,
  DocxFontFact,
  DocxFrameTextFact,
  DocxHeadingFact,
  DocxImageFact,
  DocxLineBoxFact,
  DocxMeasureFact,
  DocxOutlineFact,
  DocxPlaceholderFact,
  DocxBlockSlotFact,
  DocxQualityFact,
  DocxQualityModel,
  DocxSectionChromeFact,
  DocxSectionFact,
  DocxSvgTextFact,
  DocxTableColumnFact,
  DocxTableFact,
  DocxTableWidthFact,
  DocxTextSizeFact,
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
  description:
    'Explicit column widths that sum past the usable width of their section.',
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
  description: 'A heading that skips a level and breaks the outline.',
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
  description:
    'A word too wide for its floating frame, or a frame whose wrapped text runs off the sheet.',
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
  description:
    'Two page-anchored frames whose estimated text lands on the same region of a page.',
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
  description:
    'A text baseline outside an inline SVG’s viewBox, so the words are never painted.',
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
  description:
    'An `exactly` line box shorter than the capitals it has to hold.',
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
  description: 'An unfilled scaffold slot, or leftover filler copy.',
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
  description:
    'A block slot holding more words than its budget allows — a takeaway past the word count the block sets.',
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
    description: 'Distinct font families the document can paint.',
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
  description: 'A literal colour the resolved theme does not define.',
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
  description:
    'What a chart claims about its numbers: the comparison, the palette, the unit and the caption.',
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
  description:
    'How a table lays its numbers out: alignment, rounding, rules and length.',
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
  description:
    'A block slot with a role a profile or policy requires — a takeaway, a source — left empty. Off until one names roles.',
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

/**
 * A report that argues its numbers in prose. A data exhibit is a chart, or a
 * table with at least two columns — a stat row is a summary, not an exhibit.
 * Off by default; the client-report profile asks for one, because every
 * brief in that archetype comes with numbers the reader will check.
 */
export const docxExhibitRequiredRule: QualityRule<
  DocxQualityModel,
  DocxQualityFact
> = {
  id: 'docx/exhibit-required',
  description:
    'Fewer data exhibits — charts, or tables of two or more columns — than a profile or policy expects. Off until one sets a minimum.',
  code: QUALITY_CODES.EXHIBIT_MISSING,
  category: 'composition',
  defaultSeverity: 'warning',
  defaultCertainty: 'deterministic',
  formats: ['docx'],
  defaultEnabled: false,
  defaultParameters: { minimumExhibits: 1 },
  evaluate: ({ facts, configuration, profile }) => {
    const minimum = numberParameter(
      configuration.parameters,
      'minimumExhibits',
      1
    );
    if (minimum <= 0) return [];
    const charts = facts.filter((fact) => fact.kind === 'docx/chart').length;
    const tables = facts.filter(
      (fact): fact is DocxTableFact =>
        fact.kind === 'docx/table' && fact.columns.length >= 2
    ).length;
    const exhibits = charts + tables;
    if (exhibits >= minimum) return [];
    return [
      {
        path: themeFact(facts)?.path ?? '/props',
        message:
          exhibits === 0
            ? `The document carries no data exhibit — no chart, no table of two or more columns; the ${profile?.id ?? 'selected'} profile expects at least ${minimum}.`
            : `The document carries ${exhibits} data exhibit(s); the ${profile?.id ?? 'selected'} profile expects at least ${minimum}.`,
        suggestion:
          'Put the numbers the argument leans on into a chart-figure or a data-table block, with a takeaway and a source, where the text discusses them. A kpi-row summarises; it does not count.',
        context: { charts, tables, minimum },
      },
    ];
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
  description:
    'A body section without the running head a profile or policy expects. Off until one names parts.',
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
              'Invoke a running-head block at the top of the first body section: its section effect fills every later section with the title and n / N.',
            context: { section: fact.index, missing },
          },
        ];
      });
  },
};

/** Quarter of a point: the resolution the schema and Word both keep. */
function themeFact(
  facts: readonly DocxQualityFact[]
): DocxThemeFact | undefined {
  return facts.find(
    (fact): fact is DocxThemeFact => fact.kind === 'docx/theme'
  );
}

/** A report names its roles and paints them on pages. */
const DOCX_TYPE_VOCABULARY: TypeVocabulary = {
  subject: 'document',
  keepTo:
    'Keep to the theme styles — title, headings, body, label, source — and drop the ad-hoc sizes.',
};

/** Every size a document paints, in the vocabulary the shared rules speak. */
function paintedSizes(facts: readonly DocxQualityFact[]): PaintedSize[] {
  return facts
    .filter((fact): fact is DocxTextSizeFact => fact.kind === 'docx/text-size')
    .map((fact) => ({
      path: fact.path,
      role: fact.role,
      fontSizePt: fact.fontSizePt,
      ...(fact.sizePath !== undefined && { sizePath: fact.sizePath }),
      generated: fact.generated,
    }));
}

/**
 * An authored size the theme never paints — not a style, not a font role, not
 * a step of its scale. The theme owns the list, so a custom theme is judged
 * by its own values, and a size a block compiled from its definition is never
 * reported: the author has no pointer to patch there. Off until a profile
 * turns it on: an editorial layout on any theme sets display sizes by hand,
 * and only an archetype decides that a document must keep to the scale.
 */
export const docxTypeScaleRule: QualityRule<DocxQualityModel, DocxQualityFact> =
  {
    id: 'docx/type-scale',
    description:
      'An authored size the theme never paints: not a style, not a font role, not a step of its scale. Off until a profile or policy enables it.',
    code: QUALITY_CODES.TYPE_OFF_SCALE,
    category: 'consistency',
    defaultSeverity: 'warning',
    defaultCertainty: 'deterministic',
    formats: ['docx'],
    defaultEnabled: false,
    evaluate: ({ facts }) => {
      const theme = themeFact(facts);
      if (!theme) return [];
      const sizes = paintedSizes(facts);
      return offScaleFindings(
        sizes,
        theme.typeScalePt,
        theme.themeName,
        DOCX_TYPE_VOCABULARY,
        driftingSizes(sizes, theme.roleSizesPt)
      );
    },
  };

/**
 * How many distinct sizes a document paints, blocks included: the count of
 * what reaches the page rather than of what the author typed. Off until a
 * profile turns it on and sets `maximumSizes`: a theme sets no ceiling of its
 * own, the ceiling is an archetype convention.
 */
export const docxSizeCountRule: QualityRule<DocxQualityModel, DocxQualityFact> =
  {
    id: 'docx/size-count',
    description:
      'More distinct text sizes than maximumSizes allows, blocks included. Off until a profile or policy enables it.',
    code: QUALITY_CODES.TYPE_SIZE_COUNT,
    category: 'consistency',
    defaultSeverity: 'warning',
    defaultCertainty: 'deterministic',
    formats: ['docx'],
    defaultEnabled: false,
    defaultParameters: { maximumSizes: 8 },
    evaluate: ({ facts, configuration, profile }) =>
      sizeCountFinding(
        paintedSizes(facts),
        numberParameter(configuration.parameters, 'maximumSizes', 8),
        themeFact(facts)?.path ?? '/props',
        profile?.id,
        DOCX_TYPE_VOCABULARY
      ),
  };

/**
 * One role at two sizes: a heading level or a paragraph style that is painted
 * at more than one size across the document. The theme's size for the role is
 * the expected value, and every authored departure from it is reported and
 * repaired to it. A role that is consistently overridden is not drift. Off
 * until a profile turns it on, for the same reason as `docx/type-scale`,
 * which yields to this rule on any pointer it reports.
 */
export const docxRoleDriftRule: QualityRule<DocxQualityModel, DocxQualityFact> =
  {
    id: 'docx/role-drift',
    description:
      'One heading level, table role or paragraph style painted at two sizes; the theme size is the fix. Off until a profile or policy enables it.',
    code: QUALITY_CODES.TYPE_ROLE_DRIFT,
    category: 'consistency',
    defaultSeverity: 'warning',
    defaultCertainty: 'deterministic',
    formats: ['docx'],
    defaultEnabled: false,
    evaluate: ({ facts }) => {
      const theme = themeFact(facts);
      return theme
        ? roleDriftFindings(paintedSizes(facts), theme.roleSizesPt)
        : [];
    },
  };

/**
 * How wide a line of body copy runs. Between 45 and 90 characters a reader's
 * eye finds the next line without hunting; outside it, a page is either a
 * ribbon or a wall. The width model is an estimate — an average advance over
 * ordinary English at the body size — so the finding is `estimated` and its
 * bounds are generous.
 */
export const docxBodyMeasureRule: QualityRule<
  DocxQualityModel,
  DocxQualityFact
> = {
  id: 'docx/body-measure',
  description:
    'A section whose body copy runs outside the readable measure. Off until a profile or policy enables it.',
  code: QUALITY_CODES.BODY_MEASURE,
  category: 'legibility',
  defaultSeverity: 'warning',
  defaultCertainty: 'estimated',
  formats: ['docx'],
  defaultEnabled: false,
  defaultParameters: { minimumCharacters: 45, maximumCharacters: 90 },
  evaluate: ({ facts, configuration }) => {
    const minimum = numberParameter(
      configuration.parameters,
      'minimumCharacters',
      45
    );
    const maximum = numberParameter(
      configuration.parameters,
      'maximumCharacters',
      90
    );
    const words = new Map(
      facts
        .filter((fact): fact is DocxSectionFact => fact.kind === 'docx/section')
        .map((fact) => [fact.index, fact.words])
    );
    return (
      facts
        .filter((fact): fact is DocxMeasureFact => fact.kind === 'docx/measure')
        // A section with no prose has no measure to judge: a cover is one line
        // across the page on purpose.
        .filter((fact) => (words.get(fact.index) ?? 0) >= 40)
        .filter(
          (fact) =>
            fact.charactersPerLine < minimum || fact.charactersPerLine > maximum
        )
        .map((fact) => {
          const wide = fact.charactersPerLine > maximum;
          return {
            path: fact.path,
            message:
              `Body copy runs about ${fact.charactersPerLine} characters a line at ${fact.fontSizePt}pt; ` +
              `a readable measure is ${minimum}–${maximum}.`,
            suggestion: wide
              ? 'Widen the margins, set the body a size larger, or put the text in columns.'
              : 'Narrow the margins or set the body a size smaller.',
            context: {
              charactersPerLine: fact.charactersPerLine,
              minimum,
              maximum,
            },
            evidence: {
              actual: fact.charactersPerLine,
              expected: wide ? maximum : minimum,
              unit: 'characters',
              values: { source: 'profile' },
            },
          };
        })
    );
  },
};

/** A section that renders nothing, and a section no heading opens. */
export const docxSectionContentRule: QualityRule<
  DocxQualityModel,
  DocxQualityFact
> = {
  id: 'docx/section-content',
  description:
    'A section that renders nothing, or one that carries body copy under no heading. Off until a profile or policy enables it.',
  code: QUALITY_CODES.SECTION_EMPTY,
  category: 'hierarchy',
  defaultSeverity: 'warning',
  defaultCertainty: 'deterministic',
  formats: ['docx'],
  defaultEnabled: false,
  defaultParameters: { minimumWordsForHeading: 60 },
  evaluate: ({ facts, configuration }) => {
    const minimumWords = numberParameter(
      configuration.parameters,
      'minimumWordsForHeading',
      60
    );
    const sections = facts.filter(
      (fact): fact is DocxSectionFact => fact.kind === 'docx/section'
    );
    return sections.flatMap((fact): QualityRuleFinding[] => {
      if (fact.words === 0 && fact.exhibits === 0)
        return [
          {
            path: fact.path,
            code: QUALITY_CODES.SECTION_EMPTY,
            message:
              'This section renders nothing: no text, no table, no figure. It still starts a page.',
            suggestion:
              'Fill the section, or remove it so the document does not open a page on nothing.',
            context: { index: fact.index },
          },
        ];
      // A cover or a divider carries a few words under no heading by design;
      // a section long enough to be read owes the reader a title.
      if (fact.headings === 0 && fact.words >= minimumWords)
        return [
          {
            path: fact.path,
            code: QUALITY_CODES.SECTION_UNTITLED,
            message:
              `This section runs to ${fact.words} words under no heading, so nothing names it ` +
              'in the outline or the contents.',
            suggestion:
              'Open the section with a heading — a section-opener block, or a level-1 heading.',
            context: { index: fact.index, words: fact.words },
            evidence: {
              actual: 0,
              expected: 1,
              unit: 'headings',
              values: { source: 'profile' },
            },
          },
        ];
      return [];
    });
  },
};

/**
 * A heading Word may leave at the foot of a page with its first paragraph
 * overleaf. Every bundled theme binds its heading styles, so this fires on a
 * heading that unbinds itself or on a theme that never bound one; the fix is
 * the property Word reads.
 */
export const docxHeadingKeepNextRule: QualityRule<
  DocxQualityModel,
  DocxQualityFact
> = {
  id: 'docx/heading-keep-next',
  description:
    'A heading that is not bound to the content under it, so a page break can strand it; the fix sets keepNext on an authored heading. Off until a profile or policy enables it.',
  code: QUALITY_CODES.HEADING_ORPHAN,
  category: 'hierarchy',
  defaultSeverity: 'warning',
  defaultCertainty: 'deterministic',
  formats: ['docx'],
  defaultEnabled: false,
  evaluate: ({ facts }) =>
    facts
      .filter(
        (fact): fact is DocxHeadingFact =>
          fact.kind === 'docx/heading' && !fact.keepNext
      )
      .map((fact) => {
        // The fact is reported at the level the author wrote. A heading a
        // block compiled reports at the slot instead, and there is no
        // `props.keepNext` to add there — the definition owns that.
        const heading = /\/props\/level$/.test(fact.path)
          ? fact.path.replace(/\/props\/level$/, '')
          : undefined;
        return {
          path: heading ?? fact.path,
          message:
            'This heading is not bound to the content under it: a page break can leave it alone at the foot of a page.',
          suggestion: heading
            ? 'Set keepNext on the heading, or give the theme’s heading style keepNext so every level is bound.'
            : 'Give the theme’s heading style keepNext, or set it in the block definition that draws this heading.',
          context: { level: fact.level },
          evidence: { values: { source: 'profile' } },
          ...(heading && {
            fixes: [
              {
                op: 'add' as const,
                path: `${heading}/props/keepNext`,
                value: true,
              },
            ],
          }),
        };
      }),
};

/**
 * A figure a reader cannot name and a screen reader cannot describe. Either
 * answers the question — a caption beside the image, or alt text on it — so
 * the finding stands only when neither does.
 */
export const docxFigureLabelRule: QualityRule<
  DocxQualityModel,
  DocxQualityFact
> = {
  id: 'docx/figure-label',
  description:
    'An image with neither a caption beside it nor alt text on it. Off until a profile or policy enables it.',
  code: QUALITY_CODES.FIGURE_UNLABELLED,
  category: 'accessibility',
  defaultSeverity: 'warning',
  defaultCertainty: 'deterministic',
  formats: ['docx'],
  defaultEnabled: false,
  evaluate: ({ facts }) =>
    facts
      .filter(
        (fact): fact is DocxImageFact =>
          fact.kind === 'docx/image' &&
          fact.alt === undefined &&
          !fact.captioned
      )
      .map((fact) => ({
        path: fact.path,
        message:
          'This figure carries neither a caption nor alt text, so nothing in the document says what it shows.',
        suggestion:
          'Put the image in a figure block, which numbers and captions it, or write alt text on the image.',
        context: {},
      })),
};

/** An image drawn at an aspect the asset does not have. */
export const docxImageAspectRule: QualityRule<
  DocxQualityModel,
  DocxQualityFact
> = {
  id: 'docx/image-aspect',
  description:
    'An image drawn at an aspect the asset does not have, where the asset can be read from the document.',
  code: QUALITY_CODES.IMAGE_ASPECT,
  category: 'integrity',
  defaultSeverity: 'warning',
  defaultCertainty: 'deterministic',
  formats: ['docx'],
  defaultParameters: { tolerance: DEFAULT_IMAGE_ASPECT_TOLERANCE },
  evaluate: ({ facts, configuration }) => {
    const tolerance = numberParameter(
      configuration.parameters,
      'tolerance',
      DEFAULT_IMAGE_ASPECT_TOLERANCE
    );
    return facts
      .filter(
        (fact): fact is DocxImageFact =>
          fact.kind === 'docx/image' &&
          fact.drawnRatio !== undefined &&
          fact.naturalRatio !== undefined
      )
      .flatMap((fact) => {
        const finding = imageAspectFinding(
          {
            path: fact.path,
            drawn: fact.drawnRatio!,
            natural: fact.naturalRatio!,
          },
          'page',
          tolerance
        );
        return finding ? [finding] : [];
      });
  },
};

/**
 * A document long enough to be navigated, with no contents to navigate it by.
 * The threshold is the profile's: a memo with four headings needs none, a
 * report with a dozen does.
 */
export const docxContentsRule: QualityRule<DocxQualityModel, DocxQualityFact> =
  {
    id: 'docx/contents-missing',
    description:
      'More headings than minimumHeadings with no table of contents. Off at 0.',
    code: QUALITY_CODES.CONTENTS_MISSING,
    category: 'hierarchy',
    defaultSeverity: 'info',
    defaultCertainty: 'deterministic',
    formats: ['docx'],
    defaultParameters: { minimumHeadings: 0 },
    evaluate: ({ facts, configuration, profile }) => {
      const minimum = numberParameter(
        configuration.parameters,
        'minimumHeadings',
        0
      );
      if (minimum <= 0) return [];
      const outline = facts.find(
        (fact): fact is DocxOutlineFact => fact.kind === 'docx/outline'
      );
      if (!outline || outline.contents || outline.headings < minimum) return [];
      return [
        {
          path: outline.path,
          message:
            `The document carries ${outline.headings} headings and no table of contents; ` +
            `the ${profile?.id ?? 'selected'} profile expects one from ${minimum}.`,
          suggestion:
            'Add a `toc` component after the cover. Word fills it from the headings already there.',
          context: { headings: outline.headings, minimum },
          evidence: {
            actual: outline.headings,
            expected: minimum,
            unit: 'headings',
            values: { source: 'profile' },
          },
        },
      ];
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
    docxExhibitRequiredRule,
    docxTypeScaleRule,
    docxSizeCountRule,
    docxRoleDriftRule,
    docxBodyMeasureRule,
    docxSectionContentRule,
    docxHeadingKeepNextRule,
    docxFigureLabelRule,
    docxImageAspectRule,
    docxContentsRule,
  ],
};

/**
 * 45-90 is book typography, and the bundled themes are not books. Measured
 * over every bundled theme and both page sizes, a body line runs 97
 * characters (minimal on A4) to 121 (devportal on LETTER, whose 9.5pt body is
 * dense on purpose), and #362's blind review shipped documents in that range.
 * So an archetype judges at 125, which still catches an 8pt body or half-inch
 * margins, while the low bound still catches a measure set too narrow to read.
 */
const REPORT_MEASURE: QualityProfile['rules'] = {
  'docx/body-measure': {
    enabled: true,
    parameters: { maximumCharacters: 125 },
  },
};

export const DOCX_QUALITY_PROFILES = {
  'client-report': {
    id: 'client-report',
    formats: ['docx'],
    description:
      'Client or public-administration report: a running head with page numbers on every section after the cover, a takeaway and a source wherever a block declares them, no heading skipped, every size on the theme scale with at most eight in play, a readable measure, no empty or untitled section, every heading bound to what follows and every figure named, no page rendered empty or left half blank under the running head, and at least one chart or table.',
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
      'docx/type-scale': { enabled: true },
      'docx/size-count': { enabled: true, parameters: { maximumSizes: 8 } },
      'docx/role-drift': { enabled: true },
      // The report blocks place every figure in a captioned block, so a page
      // with no text under the running head is a stray break or an empty
      // section, not a plate. A genuine full-page figure suppresses this at
      // its page through the policy.
      'rendered/empty-page': { severity: 'warning' },
      // A section that ends early on its own page reads as unfinished; the
      // judge calls a page two-thirds blank a defect.
      'rendered/page-underfilled': { severity: 'warning' },
      // A client report argues numbers: at least one chart or real table.
      'docx/exhibit-required': { enabled: true },
      ...REPORT_MEASURE,
      'docx/section-content': { enabled: true },
      'docx/heading-keep-next': { enabled: true },
      'docx/figure-label': { enabled: true },
    },
  },
  'executive-report': {
    id: 'executive-report',
    formats: ['docx'],
    description: 'Short decision document with strict outline continuity.',
    rules: {
      'docx/heading-hierarchy': { severity: 'warning' },
      'docx/section-content': { enabled: true },
      'docx/heading-keep-next': { enabled: true },
    },
  },
  'technical-report': {
    id: 'technical-report',
    formats: ['docx'],
    description:
      'Technical report or memo: numbered sections under a running head with page numbers on every section after the cover, a source wherever a block declares one, no heading skipped, every size on the theme scale with at most nine in play, a readable measure, no empty or untitled section, every heading bound to what follows, every figure named, a contents page past eight headings, no page rendered empty or left half blank, and at least one chart or table.',
    rules: {
      // A figure or table in a technical report cites where its numbers come
      // from; the takeaway is the client report's ask, the caption is the
      // block's own.
      'docx/required-chrome': { parameters: { required: ['source'] } },
      'docx/running-head': {
        parameters: {
          required: ['header', 'footer', 'pageNumber'],
          fromSection: 1,
        },
      },
      'docx/heading-hierarchy': { severity: 'warning' },
      'docx/type-scale': { enabled: true },
      // One more than the client report: the contents list paints TOC2 and
      // the sub-headings paint heading 2.
      'docx/size-count': { enabled: true, parameters: { maximumSizes: 9 } },
      'docx/role-drift': { enabled: true },
      'rendered/empty-page': { severity: 'warning' },
      'rendered/page-underfilled': { severity: 'warning' },
      // A technical report argues from measurements: a runs table, a chart.
      'docx/exhibit-required': { enabled: true },
      ...REPORT_MEASURE,
      'docx/section-content': { enabled: true },
      'docx/heading-keep-next': { enabled: true },
      'docx/figure-label': { enabled: true },
      // Numbered sections are meant to be reached by number: past eight
      // headings a technical report owes the reader a contents page.
      'docx/contents-missing': {
        severity: 'warning',
        parameters: { minimumHeadings: 8 },
      },
    },
  },
  general: {
    id: 'general',
    formats: ['docx'],
    description:
      'Any document that names no archetype: integrity and information-design rules at their defaults, nothing required by structure.',
  },
  'legal-appendix': {
    id: 'legal-appendix',
    formats: ['docx'],
    description: 'Dense appendix: preserve integrity without editorial taste.',
  },
} as const satisfies Record<string, QualityProfile>;

export const DOCX_DEFAULT_QUALITY_PROFILE: QualityProfile =
  DOCX_QUALITY_PROFILES['general'];

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
  return typeof id === 'string' &&
    Object.prototype.hasOwnProperty.call(DOCX_PROFILES_BY_ID, id)
    ? DOCX_PROFILES_BY_ID[id]
    : undefined;
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
