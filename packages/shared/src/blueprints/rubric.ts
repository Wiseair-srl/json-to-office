/**
 * What "good" means, as data.
 *
 * It lives beside the blueprints because both answer the same question from
 * opposite ends: a blueprint says what an archetype must contain, and this
 * says how well the result has to read. Everything that judges a document is
 * generated from this table rather than written beside it — the evaluation
 * judge's prompt, `jto_critique`'s rubric, the design guide — for the same
 * reason the design notes are: a rubric restated in prose drifts from the
 * model the rules enforce, and then two parts of the same system are
 * measuring different things. These five levels are the ones
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
