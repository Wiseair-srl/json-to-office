import {
  QUALITY_CODES,
  QualityEngine,
  resolveRuleConfiguration,
  type QualityProfile,
  type QualityRule,
  type QualityRuleFinding,
  type QualityRulePack,
} from '@json-to-office/quality';
import type {
  PptxCanvasFact,
  PptxQualityFact,
  PptxQualityModel,
  PptxSlideFact,
  PptxTextFact,
} from './facts';

const RENDERER_DEFAULT_WIDTH_IN = 10;
const RENDERER_DEFAULT_HEIGHT_IN = 7.5;
// Calibrated against rendered ground truth (jto-ops quality ground-truth
// harness, 2026-08: 130 comparable mutated-template measurements plus per-box
// adjudication of every comparable authored flag, all measured from the
// soffice PDF). 0.46 is the highest value at which the stock templates stay
// warning-clean — the binding constraint, since a rule that flags known-good
// templates trains every consumer to ignore it. At that operating point the
// rendered sample catches 52% of >1-line-height spills as OVERFLOW, 91% when
// TIGHT is included, and 87% of any visible spill, with no OVERFLOW false
// alarms. Remaining misses require rendered evidence (`rendered` certainty),
// not a character-count model — see the harness header for the full method.
const DEFAULT_CHAR_WIDTH_FACTOR = 0.46;
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
  const paragraphs = fact.text.split('\n');
  const charsPerLine = Math.max(
    1,
    Math.floor(fact.boxWidthPt / (fact.fontSizePt * charWidthFactor))
  );
  let lines = 0;
  for (const paragraph of paragraphs) {
    const measured = paragraph.trimEnd();
    lines +=
      measured === ''
        ? 1
        : Math.max(1, Math.ceil(measured.length / charsPerLine));
  }
  let heightPt = fact.fontSizePt + Math.max(0, lines - 1) * fact.lineSpacingPt;
  if (paragraphs.length > 1) {
    heightPt +=
      (paragraphs.length - 1) *
      (fact.paraSpaceBeforePt + fact.paraSpaceAfterPt);
  }
  return { heightPt, lines };
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
  return {
    ...registered,
    ...requested,
    rules: { ...registered.rules, ...requested.rules },
    parameters: { ...registered.parameters, ...requested.parameters },
  };
}

export const pptxQualityEngine = new QualityEngine(PPTX_QUALITY_RULES.rules);
