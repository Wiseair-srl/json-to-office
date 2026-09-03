/**
 * What "good" means, as data.
 *
 * The judge's prompt is generated from this table rather than written beside
 * it, for the same reason the design notes are: a rubric that lives in a prose
 * prompt drifts from the model the rules enforce, and then two parts of the
 * same system are measuring different things. These five levels are the ones
 * `taste-system.md` defines; the rules cover 1-3 deterministically and this is
 * where 4 and 5 are answered.
 *
 * A higher level never compensates for a failure below it. That ordering is
 * the whole point of the scale: a beautiful document with text running off the
 * page is a level 1 failure, not a level 5 success with a caveat.
 */

export interface RubricLevel {
  level: 1 | 2 | 3 | 4 | 5;
  name: string;
  bar: string;
}

export const RUBRIC: readonly RubricLevel[] = [
  {
    level: 1,
    name: 'Integrity',
    bar: 'Nothing is clipped, overflowing, overlapping, empty or left as placeholder text. Every page renders what the author meant to put there.',
  },
  {
    level: 2,
    name: 'Legibility and accessibility',
    bar: 'Type is large enough to read at the medium it is for, contrast holds, and the reading order is obvious.',
  },
  {
    level: 3,
    name: 'Visual coherence',
    bar: 'Hierarchy, grid, rhythm, typography and colour agree across every page. Repeated elements repeat. Nothing looks hand-placed.',
  },
  {
    level: 4,
    name: 'Communicative effectiveness',
    bar: 'Density, structure, charts and tables fit the purpose. Titles say what the page concludes. Every chart has a takeaway and a source; every number has a unit.',
  },
  {
    level: 5,
    name: 'Craft and distinctiveness',
    bar: 'The composition is refined and intentional, and does not read as a template with the blanks filled in.',
  },
];

/**
 * The question the targets are actually stated against.
 *
 * A rubric score is a description; this is a decision, and it is the one the
 * programme's headline metric is made of. Asked separately so a judge that
 * likes a document cannot quietly round it up to shippable.
 */
export const SHIPPING_QUESTION =
  'Would you send this to a client, unchanged, with your name on it?';

/**
 * Sameness is a failure mode this programme creates.
 *
 * Moving design decisions into a house theme and a handful of blueprints makes
 * every document look designed and risks making them all look the same. The
 * judge is told to notice, so the scorecard can see it happening rather than
 * celebrating it as consistency.
 */
export const GENERICNESS_PENALTY =
  'Separately, rate how generic this looks: whether it reads as a document made for this brief, or as a template that would look identical for any other. A document can be clean, coherent and still generic.';

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
