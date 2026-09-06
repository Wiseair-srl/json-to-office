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
  resolveRuleConfiguration,
  tableInfoDesignFindings,
  type JsonPatchOperation,
  type QualityProfile,
  type QualityRule,
  type QualityRuleFinding,
  type QualityRulePack,
} from '@json-to-office/quality';
import type {
  PptxBlockSlotFact,
  PptxBoxFact,
  PptxCanvasFact,
  PptxChromeSlotFact,
  PptxChartFact,
  PptxColorFact,
  PptxFontFact,
  PptxPlaceholderFact,
  PptxQualityFact,
  PptxQualityModel,
  PptxSlideFact,
  PptxTableColumnFact,
  PptxTableFact,
  PptxTextFact,
  PptxThemeFact,
} from './facts';

const RENDERER_DEFAULT_WIDTH_IN = 10;
const RENDERER_DEFAULT_HEIGHT_IN = 7.5;
// Calibrated against rendered ground truth (jto-ops quality ground-truth
// harness, 2026-08: 130 comparable mutated-template measurements plus per-box
// adjudication of every comparable authored flag, all measured from the
// soffice PDF). 0.46 is the highest value at which the reference stock
// templates (jto-ops STOCK_REFERENCE_TEMPLATES; management-plan binds) stay
// warning-clean — the binding constraint, since a rule that flags known-good
// templates trains every consumer to ignore it. At that operating point the
// rendered sample catches 52% of >1-line-height spills as OVERFLOW, 91% when
// TIGHT is included, and 87% of any visible spill, with no OVERFLOW false
// alarms. Remaining misses require rendered evidence (`rendered` certainty),
// not a character-count model — see the harness header for the full method.
// The estimator itself lives in `utils/textMetrics.ts`, shared with the
// engine's bounded `fit` so both size a title the same way.
import {
  DEFAULT_CHAR_WIDTH_FACTOR,
  estimateTextHeightPt as estimateHeight,
} from '../utils/textMetrics';
const DEFAULT_SAFETY_BUFFER_PT = 8;
const DEFAULT_MIN_READABLE_FONT_PT = 7;
const DEFAULT_MAX_BODY_WORDS_PER_SLIDE = 130;

const KNOWN_CANVASES: readonly {
  w: number;
  h: number;
  label: string;
  legacy?: boolean;
}[] = [
  { w: 13.333, h: 7.5, label: '16:9 standard' },
  { w: 10, h: 5.625, label: '16:9 small' },
  { w: 7.5, h: 7.5, label: '1:1 carousel' },
  { w: 7.5, h: 9.375, label: '4:5 vertical' },
  { w: 4.5, h: 8, label: '9:16 story' },
  { w: 10, h: 7.5, label: '4:3 legacy', legacy: true },
];

function numberParameter(
  parameters: Readonly<Record<string, unknown>>,
  name: string,
  fallback: number
): number {
  const value = parameters[name];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function textFacts(facts: readonly PptxQualityFact[]): PptxTextFact[] {
  return facts.filter(
    (fact): fact is PptxTextFact => fact.kind === 'pptx/text'
  );
}

function estimateTextHeightPt(
  fact: PptxTextFact,
  charWidthFactor: number
): { heightPt: number; lines: number } | undefined {
  if (fact.boxWidthPt === undefined || fact.boxHeightPt === undefined) {
    return undefined;
  }
  return estimateHeight(
    fact.text,
    fact.boxWidthPt,
    fact.fontSizePt,
    fact.lineSpacingPt,
    fact.paraSpaceBeforePt,
    fact.paraSpaceAfterPt,
    charWidthFactor
  );
}

export const pptxCanvasRule: QualityRule<PptxQualityModel, PptxQualityFact> = {
  id: 'pptx/canvas',
  code: QUALITY_CODES.CANVAS_UNSPECIFIED,
  category: 'composition',
  defaultSeverity: 'info',
  defaultCertainty: 'deterministic',
  formats: ['pptx'],
  evaluate: ({ facts }) => {
    const canvas = facts.find(
      (fact): fact is PptxCanvasFact => fact.kind === 'pptx/canvas'
    );
    if (!canvas) return [];
    const { widthIn: width, heightIn: height } = canvas;
    if (width === undefined || height === undefined) {
      const missing = [
        width === undefined ? 'props.slideWidth' : undefined,
        height === undefined ? 'props.slideHeight' : undefined,
      ].filter((entry): entry is string => entry !== undefined);
      const state =
        missing.length === 2
          ? 'No slide canvas declared'
          : `Incomplete slide canvas (${missing[0]} missing)`;
      return [
        {
          code: QUALITY_CODES.CANVAS_UNSPECIFIED,
          severity: 'warning',
          category: 'integrity',
          message: `${state}: the renderer falls back to 4:3 (${RENDERER_DEFAULT_WIDTH_IN}×${RENDERER_DEFAULT_HEIGHT_IN}"), and 16:9 content on that canvas leaves a dead strip at the bottom.`,
          path: canvas.path,
          suggestion:
            'Declare props.slideWidth and props.slideHeight — 13.333 × 7.5 for a standard 16:9 deck.',
          context: {
            missing,
            rendererDefault: {
              slideWidth: RENDERER_DEFAULT_WIDTH_IN,
              slideHeight: RENDERER_DEFAULT_HEIGHT_IN,
            },
          },
        },
      ];
    }

    const match = KNOWN_CANVASES.find(
      (known) =>
        Math.abs(known.w - width) < 0.01 && Math.abs(known.h - height) < 0.01
    );
    if (match?.legacy) {
      return [
        {
          code: QUALITY_CODES.CANVAS_LEGACY,
          message: `Canvas is 4:3 legacy (${match.w}×${match.h}") — modern screens are 16:9.`,
          path: canvas.path,
          suggestion:
            'If 4:3 is not deliberate, use slideWidth 13.333 and slideHeight 7.5.',
        },
      ];
    }
    if (match) return [];
    return [
      {
        code: QUALITY_CODES.CANVAS_NONSTANDARD,
        message: `Canvas ${width}×${height}" matches no common preset (16:9, 1:1, 4:5, 9:16).`,
        path: canvas.path,
        suggestion:
          'Confirm the size is deliberate; a mistyped canvas distorts every slide.',
        context: {
          knownCanvases: KNOWN_CANVASES.map(({ w, h, label }) => ({
            slideWidth: w,
            slideHeight: h,
            label,
          })),
        },
      },
    ];
  },
};

export const pptxMinimumFontRule: QualityRule<
  PptxQualityModel,
  PptxQualityFact
> = {
  id: 'pptx/minimum-font-size',
  code: QUALITY_CODES.FONT_SIZE_MIN,
  category: 'legibility',
  defaultSeverity: 'warning',
  defaultCertainty: 'measured',
  formats: ['pptx'],
  defaultParameters: { minimumFontPt: DEFAULT_MIN_READABLE_FONT_PT },
  evaluate: ({ facts, configuration }) => {
    const minimum = numberParameter(
      configuration.parameters,
      'minimumFontPt',
      DEFAULT_MIN_READABLE_FONT_PT
    );
    return textFacts(facts)
      .filter((fact) => fact.fontSizePt < minimum)
      .map((fact) => ({
        message: `Effective font size is ${fact.fontSizePt}pt — unreadable on a projected slide.`,
        path: `${fact.path}/props`,
        suggestion: `Use at least ${minimum}pt; captions rarely work below 10pt.`,
        context: { fontSize: fact.fontSizePt, threshold: minimum },
        evidence: { actual: fact.fontSizePt, expected: minimum, unit: 'pt' },
        // `add` replaces an existing member, so this lifts an explicit
        // fontSize and overrides an inherited style value alike.
        fixes: [
          {
            op: 'add' as const,
            path: `${fact.path}/props/fontSize`,
            value: minimum,
          },
        ],
      }));
  },
};

/**
 * Largest whole font size that fits the box, for a ready-made overflow fix.
 *
 * Conservative on purpose: the authored leading is kept even when it derives
 * from the font size (real leading would shrink too), so a size this returns
 * fits under the same model that produced the finding. Undefined when no
 * readable size fits (the text or the box has to change) or when the box
 * auto-grows (`h` omitted — there is nothing to overflow).
 */
function fittingFontSizePt(
  fact: PptxTextFact,
  charWidthFactor: number,
  minimumFontPt: number
): number | undefined {
  if (fact.autoFit === true) return undefined;
  const minimumWholeSize = Math.ceil(minimumFontPt);
  for (
    let size = Math.floor(fact.fontSizePt) - 1;
    size >= minimumWholeSize;
    size--
  ) {
    const estimate = estimateTextHeightPt(
      { ...fact, fontSizePt: size },
      charWidthFactor
    );
    if (
      estimate !== undefined &&
      fact.boxHeightPt !== undefined &&
      estimate.heightPt <= fact.boxHeightPt
    ) {
      return size;
    }
  }
  return undefined;
}

export const pptxTextFitRule: QualityRule<PptxQualityModel, PptxQualityFact> = {
  id: 'pptx/text-fit',
  code: QUALITY_CODES.TEXT_TIGHT,
  category: 'integrity',
  defaultSeverity: 'info',
  defaultCertainty: 'estimated',
  formats: ['pptx'],
  defaultParameters: {
    characterWidthFactor: DEFAULT_CHAR_WIDTH_FACTOR,
    safetyBufferPt: DEFAULT_SAFETY_BUFFER_PT,
  },
  evaluate: ({ facts, configuration, profile, policy }) => {
    const factor = numberParameter(
      configuration.parameters,
      'characterWidthFactor',
      DEFAULT_CHAR_WIDTH_FACTOR
    );
    const safetyBufferPt = numberParameter(
      configuration.parameters,
      'safetyBufferPt',
      DEFAULT_SAFETY_BUFFER_PT
    );
    const minimumFontConfiguration = resolveRuleConfiguration(
      pptxMinimumFontRule,
      profile,
      policy
    );
    const minimumFontPt = minimumFontConfiguration.enabled
      ? numberParameter(
          minimumFontConfiguration.parameters,
          'minimumFontPt',
          DEFAULT_MIN_READABLE_FONT_PT
        )
      : DEFAULT_MIN_READABLE_FONT_PT;
    const findings: QualityRuleFinding[] = [];
    for (const fact of textFacts(facts)) {
      const estimate = estimateTextHeightPt(fact, factor);
      if (!estimate || fact.boxHeightPt === undefined) continue;
      const marginPt = fact.boxHeightPt - estimate.heightPt;
      const measured = {
        estimatedTextPt: Math.round(estimate.heightPt * 10) / 10,
        availablePt: Math.round(fact.boxHeightPt * 10) / 10,
        marginPt: Math.round(marginPt * 10) / 10,
        estimatedLines: estimate.lines,
        fontSize: fact.fontSizePt,
        boxWidthPt: Math.round((fact.boxWidthPt as number) * 10) / 10,
      };

      if (marginPt < -fact.lineSpacingPt) {
        const fittingSize = fittingFontSizePt(fact, factor, minimumFontPt);
        findings.push({
          code: QUALITY_CODES.TEXT_OVERFLOW,
          severity: 'warning',
          message: `Text is estimated at ${measured.estimatedTextPt}pt tall (${estimate.lines} line${estimate.lines === 1 ? '' : 's'} of ${fact.fontSizePt}pt) in a ${measured.availablePt}pt box — it will overflow.`,
          path: fact.path,
          suggestion:
            'Shorten the text, reduce fontSize, or enlarge the box (h / rowSpan).',
          context: measured,
          evidence: {
            actual: measured.estimatedTextPt,
            expected: measured.availablePt,
            unit: 'pt',
          },
          // A ready-made patch only when a readable size fits; shortening
          // the text or growing the box stays the author's call.
          ...(fittingSize !== undefined && {
            fixes: [
              {
                op: 'add' as const,
                path: `${fact.path}/props/fontSize`,
                value: fittingSize,
              },
            ],
          }),
        });
        continue;
      }
      if (marginPt >= safetyBufferPt) continue;
      findings.push({
        code: QUALITY_CODES.TEXT_TIGHT,
        message:
          marginPt < 0
            ? `Text is estimated to exceed its ${measured.availablePt}pt box by ${-measured.marginPt}pt — within one line-height, so likely a harmless spill into the gap below.`
            : `Text fits its box with only ${measured.marginPt}pt to spare — renderer rounding can push it over.`,
        path: fact.path,
        suggestion: `Leave at least ${safetyBufferPt}pt of vertical margin.`,
        context: measured,
        evidence: {
          actual: measured.marginPt,
          expected: safetyBufferPt,
          unit: 'pt margin',
        },
      });
    }
    return findings;
  },
};

export const pptxSlideDensityRule: QualityRule<
  PptxQualityModel,
  PptxQualityFact
> = {
  id: 'pptx/slide-density',
  code: QUALITY_CODES.SLIDE_DENSITY,
  category: 'information-design',
  defaultSeverity: 'warning',
  defaultCertainty: 'estimated',
  formats: ['pptx'],
  defaultParameters: { maximumBodyWords: DEFAULT_MAX_BODY_WORDS_PER_SLIDE },
  evaluate: ({ facts, configuration }) => {
    const threshold = numberParameter(
      configuration.parameters,
      'maximumBodyWords',
      DEFAULT_MAX_BODY_WORDS_PER_SLIDE
    );
    return facts
      .filter((fact): fact is PptxSlideFact => fact.kind === 'pptx/slide')
      .filter((fact) => fact.bodyWords > threshold)
      .map((fact) => ({
        message: `${fact.bodyWords} words of body text on one slide — an audience reads a slide, it does not study one.`,
        path: fact.path,
        suggestion: 'One idea per slide: split the content across more slides.',
        context: { bodyWords: fact.bodyWords, threshold },
        evidence: {
          actual: fact.bodyWords,
          expected: threshold,
          unit: 'words',
        },
      }));
  },
};

/**
 * WCAG 2.1 AA. Large text — 18pt, or 14pt bold — is legible at 3:1; everything
 * else needs 4.5:1. Projection is less forgiving than a screen, not more, so
 * these are floors rather than targets.
 */
const AA_NORMAL_RATIO = 4.5;
const AA_LARGE_RATIO = 3;
const LARGE_TEXT_PT = 18;
/** AA counts bold text as large from 14pt, two sizes below regular text. */
const LARGE_BOLD_TEXT_PT = 14;

function channelLuminance(channel: number): number {
  const c = channel / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** Relative luminance of a bare 6-digit hex, or undefined if unparseable. */
function relativeLuminance(hex: string): number | undefined {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!match) return undefined;
  const value = parseInt(match[1], 16);
  return (
    0.2126 * channelLuminance((value >> 16) & 255) +
    0.7152 * channelLuminance((value >> 8) & 255) +
    0.0722 * channelLuminance(value & 255)
  );
}

function contrastRatio(a: string, b: string): number | undefined {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  if (la === undefined || lb === undefined) return undefined;
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

export const pptxTextContrastRule: QualityRule<
  PptxQualityModel,
  PptxQualityFact
> = {
  id: 'pptx/text-contrast',
  code: QUALITY_CODES.TEXT_CONTRAST,
  category: 'accessibility',
  defaultSeverity: 'warning',
  defaultCertainty: 'deterministic',
  formats: ['pptx'],
  defaultParameters: {
    normalRatio: AA_NORMAL_RATIO,
    largeRatio: AA_LARGE_RATIO,
    largeTextPt: LARGE_TEXT_PT,
    largeBoldTextPt: LARGE_BOLD_TEXT_PT,
  },
  evaluate: ({ facts, configuration }) => {
    const normalRatio = numberParameter(
      configuration.parameters,
      'normalRatio',
      AA_NORMAL_RATIO
    );
    const largeRatio = numberParameter(
      configuration.parameters,
      'largeRatio',
      AA_LARGE_RATIO
    );
    const largeTextPt = numberParameter(
      configuration.parameters,
      'largeTextPt',
      LARGE_TEXT_PT
    );
    const largeBoldTextPt = numberParameter(
      configuration.parameters,
      'largeBoldTextPt',
      LARGE_BOLD_TEXT_PT
    );

    return textFacts(facts).flatMap((fact) => {
      const { colorHex, backgroundHexes } = fact;
      if (!colorHex || !backgroundHexes?.length) return [];

      // A gradient is only as legible as its worst stop: the text crosses all
      // of them, and the reader only remembers where it disappeared.
      let worst: { ratio: number; background: string } | undefined;
      for (const background of backgroundHexes) {
        const ratio = contrastRatio(colorHex, background);
        if (ratio === undefined) continue;
        if (!worst || ratio < worst.ratio) worst = { ratio, background };
      }
      if (!worst) return [];

      const isLarge =
        fact.fontSizePt >= largeTextPt ||
        (fact.bold && fact.fontSizePt >= largeBoldTextPt);
      const required = isLarge ? largeRatio : normalRatio;
      if (worst.ratio >= required) return [];

      const rounded = Math.round(worst.ratio * 100) / 100;
      return [
        {
          message: `Text at #${colorHex} on #${worst.background} has ${rounded}:1 contrast — below the ${required}:1 needed at ${fact.fontSizePt}pt${fact.bold ? ' bold' : ''}.`,
          path: fact.path,
          suggestion:
            'Darken the text, lighten it further, or change the surface behind it.',
          context: {
            colorHex,
            backgroundHex: worst.background,
            ratio: rounded,
            required,
            fontSizePt: fact.fontSizePt,
            bold: fact.bold,
            backgroundHexes,
          },
          evidence: {
            actual: rounded,
            expected: required,
            unit: ':1',
          },
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
export const pptxPlaceholderRule: QualityRule<
  PptxQualityModel,
  PptxQualityFact
> = {
  id: 'pptx/placeholder-text',
  code: QUALITY_CODES.PLACEHOLDER_TEXT,
  category: 'integrity',
  defaultSeverity: 'warning',
  defaultCertainty: 'deterministic',
  formats: ['pptx'],
  evaluate: ({ facts }) =>
    facts
      .filter(
        (fact): fact is PptxPlaceholderFact => fact.kind === 'pptx/placeholder'
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
 * Two opaque boxes on one slide that land on each other.
 *
 * Opacity is the whole of the geometric claim. An image, a chart, a table or a
 * filled rectangle paints its entire box, so two of them intersecting really
 * do hide each other. A *text* box says nothing of the kind — authors declare
 * one far larger than the words inside it, and the reference decks are full of
 * designs where two text rectangles cross and no ink does: an 80pt title
 * beside a 12pt label, a value centred in the hole of a donut. Word-level
 * overlap belongs to the rendered pass (#344), which can see where ink landed.
 *
 * Intersecting is not the same as wrong, which is why the verdict is split.
 * Reference-quality decks stack opaque rectangles constantly — an accent strip
 * along the top of a card, a badge in the corner of a photograph — so a plain
 * intersection is `info`: visible, not accused. Two cases are warnings because
 * neither is ever a design. A box whose geometry matches another to within a
 * couple of points is a leftover duplicate. And anything covering a chart or a
 * table covers data, which is the one thing a slide cannot afford to lose.
 *
 * A box fully inside a larger one is layering rather than collision. Equal
 * rectangles are not containment — that is the duplicate case, and it is
 * reported.
 */
const DEFAULT_OVERLAP_MIN_PT = 4;
const DEFAULT_OVERLAP_MIN_AREA_RATIO = 0.15;
/** Below this share of the outer box, an inner box reads as a deliberate layer. */
const CONTAINED_AREA_RATIO = 0.95;
/** Slack on the containment test: a nested box may sit a rounding step proud. */
const CONTAINMENT_SLACK_PT = 0.5;
/** Two boxes agreeing to within this on every edge are the same box, twice. */
const DUPLICATE_TOLERANCE_PT = 2;

/** Components whose whole point is data a reader has to be able to see. */
const DATA_COMPONENTS = new Set(['chart', 'highcharts', 'table']);

interface Rect {
  xPt: number;
  yPt: number;
  widthPt: number;
  heightPt: number;
}

function contains(outer: Rect, inner: Rect): boolean {
  const outerArea = outer.widthPt * outer.heightPt;
  const innerArea = inner.widthPt * inner.heightPt;
  if (outerArea === 0 || innerArea >= outerArea * CONTAINED_AREA_RATIO) {
    return false;
  }
  const slack = CONTAINMENT_SLACK_PT;
  return (
    inner.xPt >= outer.xPt - slack &&
    inner.yPt >= outer.yPt - slack &&
    inner.xPt + inner.widthPt <= outer.xPt + outer.widthPt + slack &&
    inner.yPt + inner.heightPt <= outer.yPt + outer.heightPt + slack
  );
}

function isDuplicate(a: Rect, b: Rect): boolean {
  const near = (x: number, y: number): boolean =>
    Math.abs(x - y) <= DUPLICATE_TOLERANCE_PT;
  return (
    near(a.xPt, b.xPt) &&
    near(a.yPt, b.yPt) &&
    near(a.widthPt, b.widthPt) &&
    near(a.heightPt, b.heightPt)
  );
}

export const pptxBoxOverlapRule: QualityRule<
  PptxQualityModel,
  PptxQualityFact
> = {
  id: 'pptx/box-overlap',
  code: QUALITY_CODES.BOX_OVERLAP,
  category: 'integrity',
  defaultSeverity: 'info',
  defaultCertainty: 'deterministic',
  formats: ['pptx'],
  defaultParameters: {
    minimumOverlapPt: DEFAULT_OVERLAP_MIN_PT,
    minimumAreaRatio: DEFAULT_OVERLAP_MIN_AREA_RATIO,
  },
  evaluate: ({ facts, configuration }) => {
    const minimumOverlapPt = numberParameter(
      configuration.parameters,
      'minimumOverlapPt',
      DEFAULT_OVERLAP_MIN_PT
    );
    const minimumAreaRatio = numberParameter(
      configuration.parameters,
      'minimumAreaRatio',
      DEFAULT_OVERLAP_MIN_AREA_RATIO
    );
    const bySlide = new Map<string, PptxBoxFact[]>();
    for (const fact of facts) {
      if (fact.kind !== 'pptx/box' || !fact.opaque) continue;
      const slide = bySlide.get(fact.slidePath);
      if (slide) slide.push(fact);
      else bySlide.set(fact.slidePath, [fact]);
    }

    const findings: QualityRuleFinding[] = [];
    for (const slide of bySlide.values()) {
      const ordered = [...slide].sort((a, b) => a.order - b.order);
      for (let i = 0; i < ordered.length; i += 1) {
        for (let j = i + 1; j < ordered.length; j += 1) {
          const under = ordered[i];
          const over = ordered[j];
          // A box nested in another is a group, not a collision.
          if (over.path.startsWith(`${under.path}/`)) continue;
          if (under.path.startsWith(`${over.path}/`)) continue;

          const duplicate = isDuplicate(under, over);
          if (!duplicate && (contains(under, over) || contains(over, under))) {
            continue;
          }

          const overlapWidth =
            Math.min(under.xPt + under.widthPt, over.xPt + over.widthPt) -
            Math.max(under.xPt, over.xPt);
          const overlapHeight =
            Math.min(under.yPt + under.heightPt, over.yPt + over.heightPt) -
            Math.max(under.yPt, over.yPt);
          if (
            overlapWidth < minimumOverlapPt ||
            overlapHeight < minimumOverlapPt
          ) {
            continue;
          }
          const overlapArea = overlapWidth * overlapHeight;
          const smaller = Math.min(
            under.widthPt * under.heightPt,
            over.widthPt * over.heightPt
          );
          const ratio = smaller === 0 ? 0 : overlapArea / smaller;
          if (ratio < minimumAreaRatio) continue;

          const hidesData =
            DATA_COMPONENTS.has(under.componentName) ||
            DATA_COMPONENTS.has(over.componentName);
          const percent = Math.round(ratio * 100);
          findings.push({
            severity: duplicate || hidesData ? 'warning' : 'info',
            message: duplicate
              ? `Two ${over.componentName === under.componentName ? `${over.componentName}s` : 'boxes'} occupy the same rectangle — the later one hides the earlier entirely.`
              : hidesData
                ? `A ${over.componentName} covers ${percent}% of the ${under.componentName} drawn before it, hiding data.`
                : `A ${over.componentName} covers ${percent}% of the ${under.componentName} drawn before it; both paint their whole box.`,
            path: over.path,
            relatedPaths: [under.path],
            suggestion: duplicate
              ? 'Delete whichever of the two is left over.'
              : 'Move or resize one of the two if the overlap is not deliberate.',
            context: {
              covering: over.path,
              covered: under.path,
              overlapPercent: percent,
              duplicate,
              overlapPt: {
                width: Math.round(overlapWidth * 10) / 10,
                height: Math.round(overlapHeight * 10) / 10,
              },
            },
            evidence: {
              actual: percent,
              expected: 0,
              unit: '% of the smaller box',
            },
          });
        }
      }
    }
    return findings;
  },
};

/**
 * A slide table is a summary, not a report. Twelve rows is what a 16:9 canvas
 * holds at a size an audience can read from the back of a room; past that the
 * table is being stored on the slide rather than shown.
 */
const DEFAULT_MAX_TABLE_ROWS_PER_SLIDE = 12;

/** Information design for charts: the comparison, the scale and the palette. */
export const pptxChartRule: QualityRule<PptxQualityModel, PptxQualityFact> = {
  id: 'pptx/chart-design',
  code: QUALITY_CODES.CHART_3D,
  category: 'information-design',
  defaultSeverity: 'warning',
  defaultCertainty: 'deterministic',
  formats: ['pptx'],
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
      .filter((fact): fact is PptxChartFact => fact.kind === 'pptx/chart')
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
  fact: PptxChartFact
): readonly JsonPatchOperation[] | undefined {
  if (fact.componentName !== 'chart') return undefined;
  if (fact.seriesCount < 1 || fact.paletteTokens.length === 0) return undefined;
  const tokens = Array.from(
    { length: fact.seriesCount },
    (_, index) => fact.paletteTokens[index % fact.paletteTokens.length]
  );
  return [{ op: 'add', path: fact.seriesColorsPath, value: tokens }];
}

/** Information design for tables: alignment, rounding, rules and length. */
export const pptxTableRule: QualityRule<PptxQualityModel, PptxQualityFact> = {
  id: 'pptx/table-design',
  code: QUALITY_CODES.TABLE_NUMERIC_ALIGN,
  category: 'information-design',
  defaultSeverity: 'warning',
  defaultCertainty: 'deterministic',
  formats: ['pptx'],
  defaultParameters: { maximumRows: DEFAULT_MAX_TABLE_ROWS_PER_SLIDE },
  evaluate: ({ facts, configuration }) => {
    const maximumRows = numberParameter(
      configuration.parameters,
      'maximumRows',
      DEFAULT_MAX_TABLE_ROWS_PER_SLIDE
    );
    return facts
      .filter((fact): fact is PptxTableFact => fact.kind === 'pptx/table')
      .flatMap((fact) =>
        tableInfoDesignFindings(fact, {
          maximumRows,
          rowSurface: 'slide',
          rowSeverity: 'warning',
          alignFix: alignColumnRight,
        })
      );
  },
};

/**
 * Right-align every cell of one column, header included.
 *
 * A row-major table has no column to patch, so this is one operation per row,
 * and a plain-string cell has to become an object to carry an alignment at
 * all — `replace`, never `add`, because `add` at an array index splices and
 * would push the rest of the row sideways.
 */
function alignColumnRight(
  column: PptxTableColumnFact
): readonly JsonPatchOperation[] {
  return column.cells
    .filter((entry) => {
      const cell = entry.cell;
      return typeof cell === 'string' || cell.align !== 'right';
    })
    .map((entry) => ({
      op: 'replace' as const,
      path: entry.path,
      value:
        typeof entry.cell === 'string'
          ? { text: entry.cell, align: 'right' }
          : { ...entry.cell, align: 'right' },
    }));
}

const DEFAULT_MAX_FONT_FAMILIES = 3;

/** Every family the document can paint: the theme's roles plus authored ones. */
export const pptxFontCountRule: QualityRule<PptxQualityModel, PptxQualityFact> =
  {
    id: 'pptx/font-count',
    code: QUALITY_CODES.FONT_COUNT,
    category: 'brand',
    defaultSeverity: 'warning',
    defaultCertainty: 'deterministic',
    formats: ['pptx'],
    defaultParameters: { maximumFamilies: DEFAULT_MAX_FONT_FAMILIES },
    evaluate: ({ facts, configuration }) => {
      const maximum = numberParameter(
        configuration.parameters,
        'maximumFamilies',
        DEFAULT_MAX_FONT_FAMILIES
      );
      const theme = facts.find(
        (fact): fact is PptxThemeFact => fact.kind === 'pptx/theme'
      );
      const authored = facts.filter(
        (fact): fact is PptxFontFact => fact.kind === 'pptx/font-family'
      );
      const families = new Set<string>(theme?.fontFamilies ?? []);
      const extraPaths: string[] = [];
      for (const fact of authored) {
        if (!families.has(fact.family)) extraPaths.push(fact.path);
        families.add(fact.family);
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
export const pptxPaletteRule: QualityRule<PptxQualityModel, PptxQualityFact> = {
  id: 'pptx/palette-adherence',
  code: QUALITY_CODES.OFF_PALETTE,
  category: 'brand',
  defaultSeverity: 'info',
  defaultCertainty: 'deterministic',
  formats: ['pptx'],
  evaluate: ({ facts }) => {
    const theme = facts.find(
      (fact): fact is PptxThemeFact => fact.kind === 'pptx/theme'
    );
    const palette = theme?.paletteHexes ?? {};
    const known = new Set(Object.values(palette));
    return facts
      .filter((fact): fact is PptxColorFact => fact.kind === 'pptx/color')
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

/** A block slot over the word budget its definition declares. */
export const pptxSlotBudgetRule: QualityRule<
  PptxQualityModel,
  PptxQualityFact
> = {
  id: 'pptx/slot-budget',
  code: QUALITY_CODES.SLOT_BUDGET,
  category: 'composition',
  defaultSeverity: 'warning',
  defaultCertainty: 'deterministic',
  formats: ['pptx'],
  evaluate: ({ facts }) =>
    facts
      .filter(
        (fact): fact is PptxBlockSlotFact => fact.kind === 'pptx/block-slot'
      )
      .filter((fact) => fact.words > fact.maxWords)
      .map((fact) => ({
        path: fact.path,
        message:
          `${fact.block} ${fact.slot} runs to ${fact.words} words; the slot holds ` +
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
 * Chrome a profile requires, judged where the block declared the slot.
 *
 * The rule reads roles off the document's own definitions and required roles
 * off the profile; with no profile asking for anything it says nothing. That
 * is the theme/profile boundary in one place: selecting the consulting theme
 * styles a source line, selecting the consulting profile requires one.
 */
export const pptxRequiredChromeRule: QualityRule<
  PptxQualityModel,
  PptxQualityFact
> = {
  id: 'pptx/required-chrome',
  code: QUALITY_CODES.CHROME_MISSING,
  category: 'consistency',
  defaultSeverity: 'warning',
  defaultCertainty: 'deterministic',
  formats: ['pptx'],
  defaultParameters: { required: [] },
  evaluate: ({ facts, configuration, profile }) => {
    const required = stringListParameter(configuration.parameters, 'required');
    if (required.length === 0) return [];
    return facts
      .filter(
        (fact): fact is PptxChromeSlotFact => fact.kind === 'pptx/chrome-slot'
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
 * An action title that wraps past the lines a profile allows, measured in
 * the box its definition drew and with the width model the fit pass uses.
 * Off by default (`maxLines: 0`): a label title is a content convention,
 * and only a consulting profile asks every slide to lead with a claim.
 */
export const pptxActionTitleRule: QualityRule<
  PptxQualityModel,
  PptxQualityFact
> = {
  id: 'pptx/action-title',
  code: QUALITY_CODES.ACTION_TITLE_LENGTH,
  category: 'hierarchy',
  defaultSeverity: 'warning',
  defaultCertainty: 'estimated',
  formats: ['pptx'],
  defaultParameters: { maxLines: 0 },
  evaluate: ({ facts, configuration }) => {
    const maxLines = numberParameter(configuration.parameters, 'maxLines', 0);
    if (maxLines <= 0) return [];
    return facts
      .filter(
        (fact): fact is PptxChromeSlotFact =>
          fact.kind === 'pptx/chrome-slot' &&
          fact.role === 'actionTitle' &&
          fact.estimatedLines !== undefined
      )
      .filter((fact) => (fact.estimatedLines ?? 0) > maxLines)
      .map((fact) => ({
        path: fact.path,
        relatedPaths: [fact.invocation],
        message:
          `The action title runs to ${fact.estimatedLines} lines at ${fact.fontSizePt}pt; ` +
          `an action title states its claim in at most ${maxLines}.`,
        suggestion:
          'Cut the title to one claim with a number or a verb. Move the rest into the takeaway.',
        evidence: {
          summary: 'estimated lines against the profile limit',
          actual: fact.estimatedLines,
          expected: maxLines,
          unit: 'lines',
        },
        context: { block: fact.block, slot: fact.slot },
      }));
  },
};

export const PPTX_QUALITY_RULES: QualityRulePack<
  PptxQualityModel,
  PptxQualityFact
> = {
  id: 'pptx/default',
  rules: [
    pptxCanvasRule,
    pptxMinimumFontRule,
    pptxTextFitRule,
    pptxSlideDensityRule,
    pptxTextContrastRule,
    pptxPlaceholderRule,
    pptxBoxOverlapRule,
    pptxChartRule,
    pptxTableRule,
    pptxFontCountRule,
    pptxPaletteRule,
    pptxSlotBudgetRule,
    pptxRequiredChromeRule,
    pptxActionTitleRule,
  ],
};

export const PPTX_QUALITY_PROFILES = {
  'executive-presentation': {
    id: 'executive-presentation',
    formats: ['pptx'],
    description: 'Decision deck optimized for scan speed and projection.',
    rules: {
      'pptx/minimum-font-size': { parameters: { minimumFontPt: 14 } },
      'pptx/slide-density': { parameters: { maximumBodyWords: 70 } },
    },
  },
  'technical-presentation': {
    id: 'technical-presentation',
    formats: ['pptx'],
    description: 'Portable professional presentation defaults.',
  },
  'consulting-deck': {
    id: 'consulting-deck',
    formats: ['pptx'],
    description:
      'Consulting readout: every content slide leads with a two-line action title, every chart carries a takeaway and a source.',
    rules: {
      'pptx/required-chrome': {
        parameters: { required: ['takeaway', 'source'] },
      },
      'pptx/action-title': { parameters: { maxLines: 2 } },
      'pptx/slide-density': { parameters: { maximumBodyWords: 90 } },
    },
  },
} as const satisfies Record<string, QualityProfile>;

export const PPTX_DEFAULT_QUALITY_PROFILE: QualityProfile =
  PPTX_QUALITY_PROFILES['technical-presentation'];

const PPTX_PROFILES_BY_ID: Readonly<Record<string, QualityProfile>> =
  PPTX_QUALITY_PROFILES;

/**
 * Callers name a shipped profile by id — `{ id: 'executive-presentation', formats: ['pptx'] }`.
 * Without this lookup that request reaches the engine carrying nothing but its id,
 * so the analysis runs on defaults while stamping the requested profileId.
 */
export function resolvePptxQualityProfile(
  requested: QualityProfile | undefined
): QualityProfile | undefined {
  if (!requested) return undefined;
  const registered = PPTX_PROFILES_BY_ID[requested.id];
  if (!registered) return requested;
  return mergeQualityProfiles(registered, requested);
}

export const pptxQualityEngine = new QualityEngine(PPTX_QUALITY_RULES.rules);
