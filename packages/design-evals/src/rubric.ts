/**
 * The judge's own reading of the rubric.
 *
 * The levels, the shipping question and the genericness note are shared data
 * (`@json-to-office/shared`), so the evaluation judge and `jto_critique` are
 * looking at one table. What stays here is what only an evaluation run needs:
 * the prompt built from that table, and the shapes a judge answers in.
 */
import {
  GENERICNESS_PENALTY,
  RUBRIC,
  SHIPPING_QUESTION,
} from '@json-to-office/shared';

export {
  GENERICNESS_PENALTY,
  RUBRIC,
  SHIPPING_QUESTION,
  type RubricLevel,
} from '@json-to-office/shared';

export interface JudgeVerdict {
  /** The highest level the document meets, with every level below it met. */
  level: 1 | 2 | 3 | 4 | 5;
  /** The shipping question, answered. */
  wouldShip: boolean;
  /** 0 (distinctive) to 4 (indistinguishable from any other document). */
  genericness: 0 | 1 | 2 | 3 | 4;
  /** Two or three sentences naming the specific things that decided it. */
  rationale: string;
}

/** Which of two documents is better, and by how much. */
export interface PairwiseVerdict {
  /** `a`, `b`, or `tie` when neither is meaningfully better. */
  winner: 'a' | 'b' | 'tie';
  /** `slight`, `clear` or `decisive`. */
  margin: 'slight' | 'clear' | 'decisive';
  rationale: string;
}

/** The rubric, as the judge reads it. Generated so it cannot drift. */
export function rubricPrompt(): string {
  return [
    'You are reviewing a rendered document against a five-level rubric. A higher level NEVER compensates for a failure below it: assign the highest level whose bar is met AND whose every lower bar is met.',
    '',
    ...RUBRIC.map((entry) => `${entry.level}. ${entry.name} — ${entry.bar}`),
    '',
    SHIPPING_QUESTION,
    '',
    GENERICNESS_PENALTY,
    '',
    'Judge only what you can see in the image. Do not assume anything about pages you were not shown. Be specific in the rationale: name the page and the element, not "the layout".',
  ].join('\n');
}

export const VERDICT_SCHEMA = {
  type: 'object',
  properties: {
    level: { type: 'integer', minimum: 1, maximum: 5 },
    wouldShip: { type: 'boolean' },
    genericness: { type: 'integer', minimum: 0, maximum: 4 },
    rationale: { type: 'string' },
  },
  required: ['level', 'wouldShip', 'genericness', 'rationale'],
  additionalProperties: false,
} as const;

export const PAIRWISE_SCHEMA = {
  type: 'object',
  properties: {
    winner: { type: 'string', enum: ['a', 'b', 'tie'] },
    margin: { type: 'string', enum: ['slight', 'clear', 'decisive'] },
    rationale: { type: 'string' },
  },
  required: ['winner', 'margin', 'rationale'],
  additionalProperties: false,
} as const;
