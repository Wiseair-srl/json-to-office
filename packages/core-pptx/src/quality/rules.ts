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
  imageAspectFinding,
  driftingSizes,
  offScaleFindings,
  QUALITY_CODES,
  roleDriftFindings,
  sizeCountFinding,
  type PaintedSize,
  type TypeVocabulary,
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
  PptxBulletsFact,
  PptxImageFact,
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
  description:
    'Slide dimensions: partially declared, legacy 4:3, or a size matching no known preset.',
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
  description: 'Text below the size a projected slide can carry.',
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
  description:
    'Estimated text height against its box. An estimate, not a measurement.',
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
  description: 'Body word count per slide.',
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
  description:
    'Text against the surface behind it, judged by WCAG AA. Text over an image or a chart is skipped.',
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
  description: 'An unfilled scaffold slot, or leftover filler copy.',
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
  description:
    'Two opaque boxes on one slide that land on each other. A duplicate, or anything covering data, is a warning.',
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
  description:
    'What a chart claims about its numbers: the comparison, the scale, the palette and the unit.',
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
  description:
    'How a table lays its numbers out: alignment, rounding, rules and length.',
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
    description: 'Distinct font families the deck can paint.',
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
  description: 'A literal colour the resolved theme does not define.',
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

const DEFAULT_OFF_CANVAS_TOLERANCE_PT = 2;

/**
 * Text drawn past the edge of the slide.
 *
 * Only text: a decorative shape or a photograph that bleeds off the canvas is
 * a technique, a word that does is a defect nobody can read. Judged on the
 * ink, not the box — a short left-aligned label in a box that overhangs the
 * edge by a few points loses nothing, while a wrapped title whose box sits an
 * inch off the slide loses a line. The ink is placed inside the box by the
 * text's alignment and estimated with the same width model as `text-fit`, so
 * a block body drawn for a wider canvas is caught on the narrower one it was
 * never designed for.
 */
export const pptxOffCanvasRule: QualityRule<PptxQualityModel, PptxQualityFact> =
  {
    id: 'pptx/off-canvas',
    description: 'Text ink drawn past the edge of the slide.',
    code: QUALITY_CODES.OFF_CANVAS,
    category: 'integrity',
    defaultSeverity: 'warning',
    defaultCertainty: 'measured',
    formats: ['pptx'],
    defaultParameters: {
      tolerancePt: DEFAULT_OFF_CANVAS_TOLERANCE_PT,
      characterWidthFactor: DEFAULT_CHAR_WIDTH_FACTOR,
    },
    evaluate: ({ facts, configuration }) => {
      const tolerance = numberParameter(
        configuration.parameters,
        'tolerancePt',
        DEFAULT_OFF_CANVAS_TOLERANCE_PT
      );
      const canvas = facts.find(
        (fact): fact is PptxCanvasFact => fact.kind === 'pptx/canvas'
      );
      const widthPt = (canvas?.widthIn ?? RENDERER_DEFAULT_WIDTH_IN) * 72;
      const heightPt = (canvas?.heightIn ?? RENDERER_DEFAULT_HEIGHT_IN) * 72;
      const factor = numberParameter(
        configuration.parameters,
        'characterWidthFactor',
        DEFAULT_CHAR_WIDTH_FACTOR
      );
      const findings: QualityRuleFinding[] = [];
      for (const fact of textFacts(facts)) {
        if (
          fact.boxXPt === undefined ||
          fact.boxYPt === undefined ||
          fact.boxWidthPt === undefined ||
          fact.boxHeightPt === undefined
        )
          continue;
        const longestLinePt =
          Math.max(
            0,
            ...fact.text.split('\n').map((line) => line.trimEnd().length)
          ) *
          fact.fontSizePt *
          factor;
        const inkWidthPt = Math.min(fact.boxWidthPt, longestLinePt);
        const inkHeightPt = Math.min(
          fact.boxHeightPt,
          estimateTextHeightPt(fact, factor)?.heightPt ?? fact.boxHeightPt
        );
        const inkLeft =
          fact.align === 'right'
            ? fact.boxXPt + fact.boxWidthPt - inkWidthPt
            : fact.align === 'center'
              ? fact.boxXPt + (fact.boxWidthPt - inkWidthPt) / 2
              : fact.boxXPt;
        const inkTop =
          fact.verticalAlign === 'bottom'
            ? fact.boxYPt + fact.boxHeightPt - inkHeightPt
            : fact.verticalAlign === 'middle'
              ? fact.boxYPt + (fact.boxHeightPt - inkHeightPt) / 2
              : fact.boxYPt;
        const overRight = inkLeft + inkWidthPt - widthPt;
        const overBottom = inkTop + inkHeightPt - heightPt;
        const overLeft = -inkLeft;
        const overTop = -inkTop;
        const worst = Math.max(overRight, overBottom, overLeft, overTop);
        if (worst <= tolerance) continue;
        const edge =
          worst === overRight
            ? 'right'
            : worst === overBottom
              ? 'bottom'
              : worst === overLeft
                ? 'left'
                : 'top';
        findings.push({
          path: fact.path,
          message: `Text runs ${Math.round(worst)}pt past the ${edge} edge of the slide; the reader never sees it.`,
          suggestion:
            'Move or narrow the box, or size the layout from the slide (percentages, a frame) rather than in fixed inches.',
          context: {
            edge,
            overrunPt: Math.round(worst * 10) / 10,
            slideWidthPt: widthPt,
            slideHeightPt: heightPt,
          },
          evidence: { actual: Math.round(worst), expected: 0, unit: 'pt' },
        });
      }
      return findings;
    },
  };

/** A block slot over the word budget its definition declares. */
export const pptxSlotBudgetRule: QualityRule<
  PptxQualityModel,
  PptxQualityFact
> = {
  id: 'pptx/slot-budget',
  description: 'A block slot over the word budget its definition declares.',
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
  description:
    'A block slot with a role a profile or policy requires — a takeaway, a source — left empty. Off until one names roles.',
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
  description:
    'An action-title slot that wraps past the lines a profile or policy allows. Off at 0.',
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

/** How far two title boxes may sit apart before the deck reads as unaligned. */
const TITLE_DRIFT_TOLERANCE_PT = 2;

/** A deck names its styles and paints them on slides. */
const PPTX_TYPE_VOCABULARY: TypeVocabulary = {
  subject: 'deck',
  keepTo:
    'Keep to the theme styles — title, heading, body, label, statistic — and drop the ad-hoc sizes.',
};

function pptxThemeFact(
  facts: readonly PptxQualityFact[]
): PptxThemeFact | undefined {
  return facts.find(
    (fact): fact is PptxThemeFact => fact.kind === 'pptx/theme'
  );
}

/** Every size a deck paints, in the vocabulary the shared rules speak. */
function paintedSizes(facts: readonly PptxQualityFact[]): PaintedSize[] {
  return textFacts(facts).map((fact) => ({
    path: fact.path,
    ...(fact.styleName !== undefined && { role: fact.styleName }),
    fontSizePt: fact.fontSizePt,
    ...(fact.sizePath !== undefined && { sizePath: fact.sizePath }),
    generated: fact.generated,
  }));
}

/**
 * An authored size the theme never paints: not a named style, not a type role
 * projected onto one, not the deck default, not a step of its scale. The
 * theme owns the list, so a custom theme is judged by its own values, and a
 * size a block compiled from its definition is never reported — the author
 * has no pointer to patch there. Off until a profile turns it on: a title
 * slide sets a display size by hand, and only an archetype decides that a
 * deck must keep to the scale.
 */
export const pptxTypeScaleRule: QualityRule<PptxQualityModel, PptxQualityFact> =
  {
    id: 'pptx/type-scale',
    description:
      'An authored size the theme never paints: not a style, not a type role, not a step of its scale. Off until a profile or policy enables it.',
    code: QUALITY_CODES.TYPE_OFF_SCALE,
    category: 'consistency',
    defaultSeverity: 'warning',
    defaultCertainty: 'deterministic',
    formats: ['pptx'],
    defaultEnabled: false,
    evaluate: ({ facts }) => {
      const theme = pptxThemeFact(facts);
      if (!theme) return [];
      const sizes = paintedSizes(facts);
      return offScaleFindings(
        sizes,
        theme.typeScalePt,
        theme.themeName,
        PPTX_TYPE_VOCABULARY,
        driftingSizes(sizes, theme.roleSizesPt)
      );
    },
  };

/**
 * How many distinct sizes a deck paints, blocks included: the count of what
 * reaches the slides rather than of what the author typed. Off until a
 * profile turns it on and sets `maximumSizes` — a theme sets no ceiling of
 * its own, the ceiling is an archetype convention.
 */
export const pptxSizeCountRule: QualityRule<PptxQualityModel, PptxQualityFact> =
  {
    id: 'pptx/size-count',
    description:
      'More distinct text sizes than maximumSizes allows, blocks included. Off until a profile or policy enables it.',
    code: QUALITY_CODES.TYPE_SIZE_COUNT,
    category: 'consistency',
    defaultSeverity: 'warning',
    defaultCertainty: 'deterministic',
    formats: ['pptx'],
    defaultEnabled: false,
    defaultParameters: { maximumSizes: 8 },
    evaluate: ({ facts, configuration, profile }) =>
      sizeCountFinding(
        paintedSizes(facts),
        numberParameter(configuration.parameters, 'maximumSizes', 8),
        pptxThemeFact(facts)?.path ?? '/props',
        profile?.id,
        PPTX_TYPE_VOCABULARY
      ),
  };

/**
 * One style at two sizes across the deck: a title, a body preset or a type
 * role painted at more than one size. The theme's size for the style is the
 * expected value, and every authored departure from it is reported and
 * repaired to it. A style that is consistently overridden is not drift. Off
 * until a profile turns it on, for the same reason as `pptx/type-scale`,
 * which yields to this rule on any pointer it reports.
 */
export const pptxRoleDriftRule: QualityRule<PptxQualityModel, PptxQualityFact> =
  {
    id: 'pptx/role-drift',
    description:
      'One named style or type role painted at two sizes across the deck; the theme size is the fix. Off until a profile or policy enables it.',
    code: QUALITY_CODES.TYPE_ROLE_DRIFT,
    category: 'consistency',
    defaultSeverity: 'warning',
    defaultCertainty: 'deterministic',
    formats: ['pptx'],
    defaultEnabled: false,
    evaluate: ({ facts }) => {
      const theme = pptxThemeFact(facts);
      return theme
        ? roleDriftFindings(paintedSizes(facts), theme.roleSizesPt)
        : [];
    },
  };

/**
 * The text a slide leads with, and what kind of slide it leads: an
 * `actionTitle` slot, grouped by the block that placed it, and a box set in
 * one of the theme's title styles where the slide was drawn by hand. Titles
 * are only comparable within a group — a statement slide centres its
 * assertion on purpose, and it is not drifting from the content slides.
 */
function titleGroups(
  facts: readonly PptxQualityFact[],
  styles: readonly string[]
): Map<string, PptxTextFact[]> {
  const texts = textFacts(facts).filter(
    (fact) => fact.boxXPt !== undefined && fact.boxYPt !== undefined
  );
  const groups = new Map<string, PptxTextFact[]>();
  const claimed = new Set<PptxTextFact>();
  const push = (key: string, fact: PptxTextFact): void => {
    if (claimed.has(fact)) return;
    claimed.add(fact);
    groups.set(key, [...(groups.get(key) ?? []), fact]);
  };
  for (const slot of facts) {
    if (
      slot.kind !== 'pptx/chrome-slot' ||
      (slot as PptxChromeSlotFact).role !== 'actionTitle'
    )
      continue;
    const chrome = slot as PptxChromeSlotFact;
    if (chrome.text === undefined) continue;
    // A block's slot compiles to a box whose own pointer is the invocation,
    // not the slot: the slot's text on the slot's slide is what identifies it.
    const painted = texts.find(
      (fact) => fact.slidePath === chrome.slidePath && fact.text === chrome.text
    );
    if (painted) push(chrome.block, painted);
  }
  for (const fact of texts)
    if (fact.styleName !== undefined && styles.includes(fact.styleName))
      push(`style:${fact.styleName}`, fact);
  return groups;
}

/** The value the most titles agree on, ties broken by the earliest slide. */
function prevailing(values: readonly number[]): number | undefined {
  const counts = new Map<number, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  let best: number | undefined;
  let bestCount = 0;
  for (const value of values) {
    const count = counts.get(value)!;
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Titles of one kind that do not start where the deck's other titles of that
 * kind start. A theme says nothing about where a title sits — a block
 * definition or the author places it — so the prevailing edge among the
 * deck's own titles is the expected value, and the profile is what asks them
 * to agree. Off until one turns it on.
 */
export const pptxTitleDriftRule: QualityRule<
  PptxQualityModel,
  PptxQualityFact
> = {
  id: 'pptx/title-drift',
  description:
    'A slide title away from the left edge or baseline the deck’s other titles of that kind share. Off until a profile or policy enables it.',
  code: QUALITY_CODES.TITLE_DRIFT,
  category: 'consistency',
  defaultSeverity: 'warning',
  defaultCertainty: 'deterministic',
  formats: ['pptx'],
  defaultEnabled: false,
  defaultParameters: {
    titleStyles: ['title'],
    tolerancePt: TITLE_DRIFT_TOLERANCE_PT,
  },
  evaluate: ({ facts, configuration }) => {
    const styles = stringListParameter(configuration.parameters, 'titleStyles');
    const tolerance = numberParameter(
      configuration.parameters,
      'tolerancePt',
      TITLE_DRIFT_TOLERANCE_PT
    );
    const findings: QualityRuleFinding[] = [];
    for (const [kind, titles] of titleGroups(facts, styles)) {
      // One title is nothing to compare; with two, the first states the line.
      if (titles.length < 2) continue;
      const axes = [
        {
          key: 'left edge',
          prop: 'boxXPt' as const,
          value: prevailing(titles.map((fact) => fact.boxXPt!)),
        },
        {
          key: 'baseline',
          prop: 'boxYPt' as const,
          value: prevailing(titles.map((fact) => fact.boxYPt!)),
        },
      ];
      for (const fact of titles) {
        const off = axes.filter(
          (axis) =>
            axis.value !== undefined &&
            Math.abs(fact[axis.prop]! - axis.value) > tolerance
        );
        if (off.length === 0) continue;
        const [first] = off;
        findings.push({
          path: fact.path,
          message:
            `This ${kind.startsWith('style:') ? kind.slice(6) : kind} title sits at ${off
              .map((axis) => `${axis.key} ${round(fact[axis.prop]!)}pt`)
              .join(', ')}; the deck's others share ` +
            `${off.map((axis) => `${axis.key} ${round(axis.value!)}pt`).join(', ')}.`,
          suggestion:
            'Place every title of one kind with the same block or the same coordinates, so the deck holds one line down the page.',
          context: {
            kind,
            axes: off.map((axis) => axis.key),
            slide: fact.slidePath,
          },
          evidence: {
            actual: round(fact[first.prop]!),
            expected: round(first.value!),
            unit: 'pt',
            values: { axis: first.key, source: 'profile' },
          },
        });
      }
    }
    return findings;
  },
};

const round = (value: number): number => Math.round(value * 10) / 10;

/**
 * Bullets an audience is asked to read at once. Past five, a slide is a
 * document; past twelve words, a bullet is a sentence. Both bounds are the
 * profile's — a technical deck lists ten build steps on purpose.
 */
export const pptxBulletRule: QualityRule<PptxQualityModel, PptxQualityFact> = {
  id: 'pptx/bullet-density',
  description:
    'More bullets in one box, or more words in one bullet, than the profile allows. Off at 0.',
  code: QUALITY_CODES.BULLET_COUNT,
  category: 'information-design',
  defaultSeverity: 'warning',
  defaultCertainty: 'deterministic',
  formats: ['pptx'],
  defaultParameters: { maximumBullets: 0, maximumWordsPerBullet: 0 },
  evaluate: ({ facts, configuration }) => {
    const maximumBullets = numberParameter(
      configuration.parameters,
      'maximumBullets',
      0
    );
    const maximumWords = numberParameter(
      configuration.parameters,
      'maximumWordsPerBullet',
      0
    );
    const findings: QualityRuleFinding[] = [];
    for (const fact of facts) {
      if (fact.kind !== 'pptx/bullets') continue;
      const bullets = fact as PptxBulletsFact;
      if (maximumBullets > 0 && bullets.items > maximumBullets)
        findings.push({
          path: bullets.path,
          code: QUALITY_CODES.BULLET_COUNT,
          message: `${bullets.items} bullets in one box; a slide carries at most ${maximumBullets}.`,
          suggestion:
            'Keep the ones that carry the argument and move the rest to the notes, or split the slide.',
          context: { items: bullets.items, maximum: maximumBullets },
          evidence: {
            actual: bullets.items,
            expected: maximumBullets,
            unit: 'bullets',
            values: { source: 'profile' },
          },
        });
      if (maximumWords > 0 && bullets.longestWords > maximumWords)
        findings.push({
          path: bullets.path,
          code: QUALITY_CODES.BULLET_LENGTH,
          message:
            `The longest bullet here runs to ${bullets.longestWords} words; ` +
            `a bullet states its point in at most ${maximumWords}.`,
          suggestion:
            'Cut each bullet to a claim. What is left is the speaker’s to say.',
          context: { words: bullets.longestWords, maximum: maximumWords },
          evidence: {
            actual: bullets.longestWords,
            expected: maximumWords,
            unit: 'words',
            values: { source: 'profile' },
          },
        });
    }
    return findings;
  },
};

/**
 * Content outside the theme's safe area. Chrome lives in the margin band by
 * design — a tracker at the top edge, a page number at the foot — and so
 * does a deliberate bleed, which touches an edge and spans the whole of the
 * other axis. Everything else belongs inside the margin the theme drew.
 */
export const pptxSafeAreaRule: QualityRule<PptxQualityModel, PptxQualityFact> =
  {
    id: 'pptx/safe-area',
    description:
      'Content outside the theme’s safe area that is neither chrome nor a full bleed. Off until a profile or policy enables it.',
    code: QUALITY_CODES.SAFE_AREA,
    category: 'composition',
    defaultSeverity: 'warning',
    defaultCertainty: 'measured',
    formats: ['pptx'],
    defaultEnabled: false,
    defaultParameters: { tolerancePt: 2 },
    evaluate: ({ facts, configuration }) => {
      const tolerance = numberParameter(
        configuration.parameters,
        'tolerancePt',
        2
      );
      const canvas = facts.find(
        (fact): fact is PptxCanvasFact => fact.kind === 'pptx/canvas'
      );
      const safe = canvas?.safeAreaPt;
      if (canvas === undefined || safe === undefined || safe <= 0) return [];
      const chromePaths = new Set(
        facts
          .filter(
            (fact): fact is PptxChromeSlotFact =>
              fact.kind === 'pptx/chrome-slot' &&
              (fact.role === 'tracker' || fact.role === 'footer')
          )
          .map((fact) => fact.path)
      );
      const chromeStyles = new Set(['footer', 'tracker']);
      const styledChrome = new Set(
        textFacts(facts)
          .filter(
            (fact) =>
              fact.styleName !== undefined && chromeStyles.has(fact.styleName)
          )
          .map((fact) => fact.path)
      );
      return facts
        .filter((fact): fact is PptxBoxFact => fact.kind === 'pptx/box')
        .filter(
          (fact) => !chromePaths.has(fact.path) && !styledChrome.has(fact.path)
        )
        .flatMap((fact) => {
          const right = fact.xPt + fact.widthPt;
          const bottom = fact.yPt + fact.heightPt;
          // A bleed touches an edge and runs the full length of the other
          // axis: a band across the top, a column down the side.
          const spansWidth =
            fact.xPt <= tolerance && right >= canvas.widthPt - tolerance;
          const spansHeight =
            fact.yPt <= tolerance && bottom >= canvas.heightPt - tolerance;
          if (spansWidth || spansHeight) return [];
          const breaches: string[] = [];
          if (fact.xPt < safe - tolerance) breaches.push('left');
          if (fact.yPt < safe - tolerance) breaches.push('top');
          if (right > canvas.widthPt - safe + tolerance) breaches.push('right');
          if (bottom > canvas.heightPt - safe + tolerance)
            breaches.push('bottom');
          if (breaches.length === 0) return [];
          const worst = Math.max(
            safe - fact.xPt,
            safe - fact.yPt,
            right - (canvas.widthPt - safe),
            bottom - (canvas.heightPt - safe)
          );
          return [
            {
              path: fact.path,
              message:
                `This ${fact.componentName} crosses the theme's ${Math.round(safe)}pt safe area at the ` +
                `${breaches.join(' and ')}, by ${Math.round(worst * 10) / 10}pt.`,
              suggestion:
                'Move it inside the margin, or make it a full bleed that runs edge to edge.',
              context: { edges: breaches, safeAreaPt: safe },
              evidence: {
                actual: Math.round(worst * 10) / 10,
                expected: 0,
                unit: 'pt',
                values: { source: 'theme' },
              },
            },
          ];
        });
    },
  };

/**
 * A slide carrying content that nothing names. The title may be a block's
 * `actionTitle` slot or a box in one of the theme's title styles; a slide
 * with nothing but chrome on it is a divider, not an untitled slide.
 */
export const pptxSlideTitleRule: QualityRule<
  PptxQualityModel,
  PptxQualityFact
> = {
  id: 'pptx/slide-title',
  description:
    'A content slide with no title: no actionTitle slot, no box in a title style. Off until a profile or policy enables it.',
  code: QUALITY_CODES.SLIDE_UNTITLED,
  category: 'hierarchy',
  defaultSeverity: 'warning',
  defaultCertainty: 'deterministic',
  formats: ['pptx'],
  defaultEnabled: false,
  defaultParameters: { titleStyles: ['title', 'display', 'heading1'] },
  evaluate: ({ facts, configuration }) => {
    const styles = stringListParameter(configuration.parameters, 'titleStyles');
    const titledSlides = new Set<string>();
    for (const fact of textFacts(facts))
      if (fact.styleName !== undefined && styles.includes(fact.styleName))
        titledSlides.add(fact.slidePath);
    for (const fact of facts)
      if (
        fact.kind === 'pptx/chrome-slot' &&
        (fact as PptxChromeSlotFact).role === 'actionTitle' &&
        (fact as PptxChromeSlotFact).present
      )
        titledSlides.add((fact as PptxChromeSlotFact).slidePath);
    return facts
      .filter(
        (fact): fact is PptxSlideFact =>
          fact.kind === 'pptx/slide' &&
          fact.contentBoxes > 0 &&
          !titledSlides.has(fact.path)
      )
      .map((fact) => ({
        path: fact.path,
        message:
          'This slide carries content under no title, so nothing tells the reader what it is for.',
        suggestion:
          'Lead the slide with a claim: an action title in a block, or a box in the theme’s title style.',
        context: { contentBoxes: fact.contentBoxes },
        evidence: {
          actual: 0,
          expected: 1,
          unit: 'titles',
          values: { source: 'profile' },
        },
      }));
  },
};

/** An image drawn at an aspect the asset does not have. */
export const pptxImageAspectRule: QualityRule<
  PptxQualityModel,
  PptxQualityFact
> = {
  id: 'pptx/image-aspect',
  description:
    'An image drawn at an aspect the asset does not have, where the asset can be read from the document.',
  code: QUALITY_CODES.IMAGE_ASPECT,
  category: 'integrity',
  defaultSeverity: 'warning',
  defaultCertainty: 'deterministic',
  formats: ['pptx'],
  defaultParameters: { tolerance: DEFAULT_IMAGE_ASPECT_TOLERANCE },
  evaluate: ({ facts, configuration }) => {
    const tolerance = numberParameter(
      configuration.parameters,
      'tolerance',
      DEFAULT_IMAGE_ASPECT_TOLERANCE
    );
    return facts
      .filter(
        (fact): fact is PptxImageFact =>
          fact.kind === 'pptx/image' &&
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
          'slide',
          tolerance
        );
        return finding ? [finding] : [];
      });
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
    pptxOffCanvasRule,
    pptxSlotBudgetRule,
    pptxRequiredChromeRule,
    pptxActionTitleRule,
    pptxTypeScaleRule,
    pptxSizeCountRule,
    pptxRoleDriftRule,
    pptxTitleDriftRule,
    pptxBulletRule,
    pptxSafeAreaRule,
    pptxSlideTitleRule,
    pptxImageAspectRule,
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
      'pptx/bullet-density': {
        parameters: { maximumBullets: 5, maximumWordsPerBullet: 12 },
      },
      'pptx/slide-title': { enabled: true },
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
      'Consulting readout: every content slide leads with a two-line action title, every chart carries a takeaway and a source, content stays inside the theme’s safe area, bullets stay under five and under twelve words, every size is on the theme scale with at most eight in play, and titles of one kind hold one line.',
    rules: {
      'pptx/required-chrome': {
        parameters: { required: ['takeaway', 'source'] },
      },
      'pptx/action-title': { parameters: { maxLines: 2 } },
      'pptx/slide-density': { parameters: { maximumBodyWords: 90 } },
      'pptx/type-scale': { enabled: true },
      'pptx/size-count': { enabled: true, parameters: { maximumSizes: 8 } },
      'pptx/role-drift': { enabled: true },
      'pptx/title-drift': {
        enabled: true,
        parameters: { titleStyles: ['title', 'display'] },
      },
      'pptx/bullet-density': {
        parameters: { maximumBullets: 5, maximumWordsPerBullet: 12 },
      },
      'pptx/safe-area': { enabled: true },
      'pptx/slide-title': { enabled: true },
    },
  },
} as const satisfies Record<string, QualityProfile>;

export const PPTX_DEFAULT_QUALITY_PROFILE: QualityProfile =
  PPTX_QUALITY_PROFILES['technical-presentation'];

const PPTX_PROFILES_BY_ID: Readonly<Record<string, QualityProfile>> =
  PPTX_QUALITY_PROFILES;

/**
 * The shipped profile a deck names in `props.qualityProfile`, so that
 * validation without arguments judges a blueprint scaffold by its archetype.
 * An unknown name is nobody's profile: the format default applies.
 */
export function declaredPptxQualityProfile(
  document: unknown
): QualityProfile | undefined {
  const props = (document as { props?: { qualityProfile?: unknown } })?.props;
  const id = props?.qualityProfile;
  return typeof id === 'string' &&
    Object.prototype.hasOwnProperty.call(PPTX_PROFILES_BY_ID, id)
    ? PPTX_PROFILES_BY_ID[id]
    : undefined;
}

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
