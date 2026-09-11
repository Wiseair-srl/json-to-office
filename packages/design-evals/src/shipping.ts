/**
 * What "would ship" means, as data (#409).
 *
 * The programme's headline target is stated against one decision — would the
 * document be sent unchanged — and until now that decision was whatever the
 * judge answered to one sentence. Measured against Paolo it was far stricter
 * than Paolo: on the exhibit-rule set it shipped 8 of 24 where Paolo shipped
 * 22, and across every human judgment its agreement was barely above chance.
 * So the decision becomes a definition that can be read, calibrated, frozen
 * and then checked on documents nobody tuned it on.
 *
 * A definition combines at most four things, each already measured on every
 * run: the judge's answer to a named shipping question, a floor on the
 * judge's rubric level, the absence of an integrity defect, and a ceiling on
 * pages the rendered pass found empty or under-filled. The candidates below
 * are written down before the calibration sitting that scores them; the one
 * that is frozen is recorded, with its hash, in
 * `baselines/shipping-definition.json`, and a scorecard says which definition
 * its `wouldShip` was computed under.
 */

import { createHash } from 'node:crypto';

import type { RunOutcome } from './metrics.js';
import { SHIPPING_QUESTION } from './rubric.js';

/**
 * The shipping questions a judge can be asked, by id.
 *
 * `v1` is the question every recorded baseline was judged with. `v2` is #409's
 * definition put to the judge directly: sendable after reading the argument,
 * with the formatting untouched — which is what Paolo's rejections were about
 * (all of them named pages), and not what the judge's were (craft and
 * distinctiveness, which the rubric's level already scores).
 */
export const SHIPPING_QUESTIONS = {
  v1: SHIPPING_QUESTION,
  v2: 'Read the argument, then answer: would you send this to the client as it is, with its formatting untouched? Say no only for something you would have to fix before sending — an empty or mostly blank page, text that is clipped, overlapping or too small to read, a chart or table that is broken or unreadable, leftover placeholder text, or an argument that does not hold together. Polish you would welcome but would not insist on is not a reason to say no; that is what the level is for.',
} as const;

export type ShippingQuestionId = keyof typeof SHIPPING_QUESTIONS;

/** An integrity defect is anything that would be visible in the rendered file. */
export const INTEGRITY_CODES: ReadonlySet<string> = new Set([
  'W_QUALITY_TEXT_OVERFLOW',
  'W_QUALITY_BOX_OVERLAP',
  'W_QUALITY_FRAME_COLLISION',
  'W_QUALITY_SVG_TEXT_CLIPPED',
  'W_QUALITY_LINE_BOX_COLLAPSE',
  'W_QUALITY_TABLE_WIDTH_OVERFLOW',
  'W_QUALITY_PLACEHOLDER_TEXT',
  'W_QUALITY_SCAFFOLD_MARKER',
  'W_QUALITY_RENDERED_CLIP',
  'W_QUALITY_RENDERED_SPILL',
  'W_QUALITY_RENDERED_OVERLAP',
  'W_QUALITY_RENDERED_TEXT_MISSING',
]);

/**
 * Pages the rendered pass found wanting: blank or chrome-only, or a middle
 * page less than half filled, or a last page that is a stub. One finding per
 * page, so their sum is a page count.
 */
export const PAGE_DEFECT_CODES: readonly string[] = [
  'W_QUALITY_RENDERED_EMPTY_PAGE',
  'W_QUALITY_RENDERED_PAGE_UNDERFILLED',
];

export interface ShippingDefinition {
  id: string;
  /** One sentence: what a document has to be for this definition to ship it. */
  summary: string;
  /** The question whose sitting this definition reads the judge's answers from. */
  question: ShippingQuestionId;
  /** Ship only when the judge answered yes to `question`. */
  judgeAnswer: boolean;
  /** Ship only at this rubric level or above; 0 reads no level. */
  minimumLevel: number;
  /** Ship only without an integrity defect. */
  noIntegrityDefect: boolean;
  /** Ship only with at most this many empty or under-filled pages; absent reads none. */
  maximumPageDefects?: number;
}

/** What a definition reads from the judge: the level, and the shipping answer. */
export interface JudgeAnswer {
  level: number;
  wouldShip: boolean;
}

/** What a definition decides on: all of it already on every run. */
export interface ShippingFacts {
  outcome: RunOutcome;
  /** The judge's verdict under the definition's question, when one exists. */
  judge?: JudgeAnswer;
  qualityByCode: Readonly<Record<string, number>>;
}

export function pageDefects(
  qualityByCode: Readonly<Record<string, number>>
): number {
  return PAGE_DEFECT_CODES.reduce(
    (sum, code) => sum + (qualityByCode[code] ?? 0),
    0
  );
}

export function hasIntegrityDefect(
  qualityByCode: Readonly<Record<string, number>>
): boolean {
  return Object.entries(qualityByCode).some(
    ([code, count]) => count > 0 && INTEGRITY_CODES.has(code)
  );
}

/**
 * Whether the definition ships the run.
 *
 * `undefined` when it needs a verdict the run does not have — a judge that
 * failed is an outage, not a "no", and calibration must be able to tell the
 * two apart. A scorecard counts it as not shipped, as it always has.
 */
export function ships(
  definition: ShippingDefinition,
  facts: ShippingFacts
): boolean | undefined {
  if (facts.outcome === 'failed') return false;
  if (definition.noIntegrityDefect && hasIntegrityDefect(facts.qualityByCode)) {
    return false;
  }
  if (
    definition.maximumPageDefects !== undefined &&
    pageDefects(facts.qualityByCode) > definition.maximumPageDefects
  ) {
    return false;
  }
  const needsVerdict = definition.judgeAnswer || definition.minimumLevel > 0;
  if (!needsVerdict) return true;
  if (!facts.judge) return undefined;
  if (definition.judgeAnswer && !facts.judge.wouldShip) return false;
  return facts.judge.level >= definition.minimumLevel;
}

/**
 * A definition's identity: its terms and the exact wording of its question.
 *
 * The wording is hashed with it because a question reworded after freezing is
 * a different instrument even under the same id.
 */
export function definitionHash(definition: ShippingDefinition): string {
  const canonical = JSON.stringify({
    id: definition.id,
    question: definition.question,
    questionText: SHIPPING_QUESTIONS[definition.question],
    judgeAnswer: definition.judgeAnswer,
    minimumLevel: definition.minimumLevel,
    noIntegrityDefect: definition.noIntegrityDefect,
    maximumPageDefects: definition.maximumPageDefects ?? null,
  });
  return createHash('sha256').update(canonical).digest('hex');
}

/**
 * The candidates, written down before the calibration sitting scores them.
 *
 * Six, because each answers a different account of the gap between the judge
 * and Paolo: the question is worded wrongly (`judge-v2`), the judge's level is
 * the better reading (`excellent`), the level is right but blind to defects
 * the rendered pass sees (`excellent-clean`), sendability is mostly about pages
 * (`clean-pages`), or the reworded question still needs the mechanical floor
 * under it (`judge-v2-clean`). `judge-v1` is the status quo every recorded
 * baseline used, kept so its agreement is measured on the same sitting.
 */
export const CANDIDATE_DEFINITIONS: readonly ShippingDefinition[] = [
  {
    id: 'judge-v1',
    summary:
      'The judge answers yes to the original shipping question: send it unchanged, with your name on it.',
    question: 'v1',
    judgeAnswer: true,
    minimumLevel: 0,
    noIntegrityDefect: false,
  },
  {
    id: 'judge-v2',
    summary:
      'The judge answers yes to the reworded question: sendable after reading the argument, with the formatting untouched.',
    question: 'v2',
    judgeAnswer: true,
    minimumLevel: 0,
    noIntegrityDefect: false,
  },
  {
    id: 'excellent',
    summary:
      'The judge places the document at rubric level 4 or above, whatever it answers to the shipping question.',
    question: 'v1',
    judgeAnswer: false,
    minimumLevel: 4,
    noIntegrityDefect: false,
  },
  {
    id: 'excellent-clean',
    summary:
      'Rubric level 4 or above, and no integrity defect the static or rendered checks can see.',
    question: 'v1',
    judgeAnswer: false,
    minimumLevel: 4,
    noIntegrityDefect: true,
  },
  {
    id: 'clean-pages',
    summary:
      'Rubric level 3 or above, no integrity defect, and at most one page the rendered pass finds empty or under-filled.',
    question: 'v1',
    judgeAnswer: false,
    minimumLevel: 3,
    noIntegrityDefect: true,
    maximumPageDefects: 1,
  },
  {
    id: 'judge-v2-clean',
    summary:
      'The judge answers yes to the reworded question, with no integrity defect and at most one empty or under-filled page.',
    question: 'v2',
    judgeAnswer: true,
    minimumLevel: 0,
    noIntegrityDefect: true,
    maximumPageDefects: 1,
  },
];

/**
 * Today's definition, until a frozen one replaces it: the judge's own answer
 * to the original question. What every recorded scorecard computed.
 */
export const STATUS_QUO_DEFINITION: ShippingDefinition =
  CANDIDATE_DEFINITIONS[0];
