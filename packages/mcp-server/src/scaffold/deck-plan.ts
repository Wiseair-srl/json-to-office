/**
 * What a deck's body slides become when an outline says more than the
 * variant's structure can hold as it stands (#421).
 *
 * The ordinal mapping is unchanged: the nth `##` is the nth content slide.
 * What changes is that three kinds of section no longer have to fit one slide
 * as authored. A section whose bullets are all measurements becomes rows of
 * measurements; a section with more bullets than a slide's list takes becomes
 * as many slides as the list needs, in order, the later ones marked
 * `(cont.)`; and a table fills the evidence column of the two-column slide
 * that holds one — the first of the section's slides, when it has several.
 *
 * Three properties hold, and the tests are written against them:
 *
 * - Nothing is invented. Every value written here is a substring of the
 *   outline; a slide the outline says nothing about keeps its `{{…}}` markers
 *   and stays on the fill map.
 * - Nothing is moved. Bullets, table rows and facts keep the order they were
 *   written in, and a section's slides are consecutive.
 * - Nothing new is registered. A slide is always a structural clone of one the
 *   variant already had, so its block invocation, its definitions and their
 *   dependencies are the ones the blueprint chose.
 *
 * When the variant has no slide of the shape a section asks for, the section
 * is left exactly as it would have been without any of this, and the caller is
 * told which shape was wanted and what the variant has instead.
 */

import type { JsonBlockDefinition } from '@json-to-office/shared';

import { ERROR_CODES, diagnostic, type Diagnostic } from '../lib/errors.js';
import { isRecord } from '../workspace/json-pointer.js';
import type { Outline, OutlineSection, OutlineTable } from './outline.js';

/**
 * The block that makes a slide the deck's cover rather than a section's.
 *
 * The ordinal mapping in `tools/scaffold.ts` excludes the same block from its
 * openers; naming it once is what keeps "the nth `##` is the nth content
 * slide" meaning the same thing on both sides.
 */
export const COVER_BLOCK = 'cover';

/** A measurement read out of a bullet, in the shape a KPI item takes. */
export interface NumericFact {
  label: string;
  value: string;
  unit?: string;
  delta?: string;
}

/** `Label: figure` with an optional parenthesised change after it. */
const FACT =
  /^(?<label>[^:]{1,60}?)\s*:\s*(?<figure>[^():]{1,14}?)\s*(?:\(\s*(?<delta>[^)]{1,12})\s*\))?$/;

/** A second word after the figure is its unit — `41 pts`, `4.2 %`. */
const UNIT_WORD = /^[A-Za-z%€$£][A-Za-z%.]{0,4}$/;

/** Everything up to the last digit is the value; whatever trails it is the unit. */
const VALUE_UNIT = /^(.*\d)(\D*)$/;

/** A line naming where the numbers came from, whatever slide it lands on. */
const SOURCE_LINE = /^sources?\s*:/i;

/**
 * How long a figure and its unit may be to still read as a measurement.
 *
 * These are the grammar's own bounds, set where the consulting KPI block's
 * value and unit slots are: something longer than this is prose with a number
 * in it, and putting it in a KPI row would only produce a slot failure.
 */
const MAX_VALUE_LENGTH = 7;
const MAX_UNIT_LENGTH = 5;

/**
 * The measurement a bullet states, or undefined when it states a claim.
 *
 * The grammar is narrow on purpose: a label, a colon, and a figure of one or
 * two words containing a digit — `Churn: 3.1%`, `Margin: 41 pts (+3.2)`. A
 * sentence with a number in it is a sentence, and stays a bullet.
 */
export function numericFact(bullet: string): NumericFact | undefined {
  const groups = bullet.trim().match(FACT)?.groups;
  if (!groups) return undefined;
  const words = groups.figure.split(/\s+/).filter(Boolean);
  if (words.length === 0 || words.length > 2) return undefined;
  const split = words[0].match(VALUE_UNIT);
  if (!split) return undefined;
  let [, value, unit] = split;
  if (words.length === 2) {
    if (unit !== '' || !UNIT_WORD.test(words[1])) return undefined;
    unit = words[1];
  }
  if (value.length > MAX_VALUE_LENGTH || unit.length > MAX_UNIT_LENGTH)
    return undefined;
  return {
    label: groups.label.trim(),
    value,
    ...(unit !== '' && { unit }),
    ...(groups.delta !== undefined && { delta: groups.delta.trim() }),
  };
}

/** The shape of slide a section asks for; `none` keeps the variant's own. */
type Shape = 'kpi' | 'table' | 'bullets' | 'none';

/**
 * Everything that differs between the three shapes, in one table.
 *
 * `holds` is what makes a slide a donor for the shape, `list` the array slot
 * that decides how many slides the section needs (none, for a table), and the
 * two names are the shape as the diagnostics say it — once as what a section
 * reads as, once as what its slides are.
 */
const SHAPES: Record<
  Exclude<Shape, 'none'>,
  {
    holds: (slide: unknown) => boolean;
    list?: 'items' | 'bullets';
    reads: string;
    slides: string;
  }
> = {
  kpi: {
    holds: (slide) => Array.isArray(slotsOf(slide)?.items),
    list: 'items',
    reads: 'a row of measurements',
    slides: 'measurement',
  },
  bullets: {
    holds: (slide) => Array.isArray(slotsOf(slide)?.bullets),
    list: 'bullets',
    reads: 'a bullet list',
    slides: 'bullet',
  },
  table: {
    holds: (slide) => contentIs(slide, 'table'),
    reads: 'a table',
    slides: 'table',
  },
};

/** A section, after the source line has been taken out of it. */
interface Content {
  source?: string;
  paragraphs: string[];
  bullets: string[];
  facts: NumericFact[];
  tables: OutlineTable[];
}

function contentOf(section: OutlineSection): Content {
  const source = section.lines.find((line) => SOURCE_LINE.test(line));
  const keep = (line: string) => line !== source;
  const bullets = section.bullets.filter(keep);
  return {
    ...(source !== undefined && { source }),
    paragraphs: section.paragraphs.filter(keep),
    bullets,
    facts: bullets
      .map(numericFact)
      .filter((fact): fact is NumericFact => fact !== undefined),
    tables: section.tables,
  };
}

/**
 * Bullets decide how many slides a section needs, so they are read before a
 * table: a section that has both becomes as many bullet slides as its list
 * needs, and the table fills the first one's evidence column.
 */
function shapeOf(content: Content): Shape {
  if (
    content.bullets.length >= 2 &&
    content.facts.length === content.bullets.length
  )
    return 'kpi';
  if (content.bullets.length > 0) return 'bullets';
  if (content.tables.length > 0) return 'table';
  return 'none';
}

/** The block invocation a slide carries, when it carries exactly one. */
function invocationOf(slide: unknown): Record<string, unknown> | undefined {
  if (!isRecord(slide) || !Array.isArray(slide.children)) return undefined;
  const block = slide.children.find(
    (child) => isRecord(child) && child.name === 'block'
  );
  return isRecord(block) ? block : undefined;
}

function slotsOf(slide: unknown): Record<string, unknown> | undefined {
  const props = invocationOf(slide)?.props;
  return isRecord(props) && isRecord(props.slots) ? props.slots : undefined;
}

function refOf(slide: unknown): string | undefined {
  const props = invocationOf(slide)?.props;
  return isRecord(props) && typeof props.ref === 'string'
    ? props.ref
    : undefined;
}

/** Whether a slide's `content` slot holds a component of this name. */
function contentIs(slide: unknown, name: string): boolean {
  const content = slotsOf(slide)?.content;
  return isRecord(content) && content.name === name;
}

function fits(slide: unknown, shape: Shape): boolean {
  if (shape === 'none') return true;
  return slotsOf(slide) !== undefined && SHAPES[shape].holds(slide);
}

/** How many entries an array slot takes, when the block bounds it. */
function listMax(
  definitions: Readonly<Record<string, JsonBlockDefinition>>,
  ref: string | undefined,
  slot: string
): number {
  const declared = ref ? definitions[ref]?.slots?.[slot] : undefined;
  return declared?.maxItems ?? Number.POSITIVE_INFINITY;
}

/**
 * Split `count` items into consecutive groups of at most `max`, as evenly as
 * the count allows: five facts into a four-item row become three and two, not
 * four and one, so no slide ends up carrying a single number.
 */
export function groupSizes(count: number, max: number): number[] {
  if (count <= max) return [count];
  const groups = Math.ceil(count / max);
  const base = Math.floor(count / groups);
  const wide = count % groups;
  return Array.from({ length: groups }, (_, i) => base + (i < wide ? 1 : 0));
}

export interface DeckPlan {
  /** The variant's children, reshaped; the same array when nothing applied. */
  children: unknown[];
  /**
   * Sections this placed in full. The ordinal mapping skips them: their slides
   * carry no title marker any more, so the openers left over line up with the
   * sections left over.
   */
  handled: Set<number>;
  diagnostics: Diagnostic[];
}

export interface PlanDeckInput {
  children: readonly unknown[];
  outline: Outline;
  definitions: Readonly<Record<string, JsonBlockDefinition>>;
}

export function planDeck(input: PlanDeckInput): DeckPlan {
  const children = structuredClone(input.children) as unknown[];
  const handled = new Set<number>();
  const diagnostics: Diagnostic[] = [];
  // Body slides are every slide that is not the cover, in order: the same
  // slides, in the same order, that the ordinal mapping calls openers.
  const body = children
    .map((slide, index) => ({ slide, index }))
    .filter(({ slide }) => refOf(slide) !== COVER_BLOCK);

  /** Replacements by body position, applied together so indices stay stable. */
  const replacements = new Map<number, unknown[]>();

  input.outline.sections.forEach((section, position) => {
    const at = body[position];
    if (!at) return; // More sections than slides: the ordinal mapping reports it.
    const content = contentOf(section);
    const shape = shapeOf(content);
    if (shape === 'none') return;

    // The slide the section would have had, when it holds the shape; else the
    // first of the variant's own that does. A section with a table beside its
    // bullets prefers a donor with an evidence column that takes one.
    const wanted = (slide: unknown) =>
      fits(slide, shape) &&
      (shape !== 'bullets' ||
        content.tables.length === 0 ||
        contentIs(slide, 'table'));
    const candidates = body.map(({ slide }) => slide);
    const donor = wanted(at.slide)
      ? at.slide
      : // A donor that takes the table too, else any that takes the shape.
        candidates.find(wanted) ??
        (fits(at.slide, shape)
          ? at.slide
          : candidates.find((slide) => fits(slide, shape)));
    if (!donor) {
      diagnostics.push(
        unmapped(
          `"${section.heading}" reads as ${describe(shape)}, and no slide of this variant holds one; it was filled as the variant’s own slide instead.`,
          { shape, headings: [section.heading] },
          `/children/${at.index}`
        )
      );
      return;
    }

    const slides = fill(donor, section, content, shape, input.definitions);
    if (!slides.titled) {
      // The donor takes the shape but has nowhere to put the heading, so the
      // section would lose its title and the next one would inherit its
      // slide. Leave it to the ordinal mapping, which has neither problem.
      diagnostics.push(
        unmapped(
          `"${section.heading}" reads as ${describe(shape)}, and the slide that holds one has no title to put the heading on; it was filled as the variant's own slide instead.`,
          { shape, headings: [section.heading] },
          `/children/${at.index}`
        )
      );
      return;
    }
    replacements.set(at.index, slides.nodes);
    diagnostics.push(...slides.diagnostics);
    handled.add(position);
    diagnostics.push(
      diagnostic(
        ERROR_CODES.OUTLINE_TRANSFORMED,
        `"${section.heading}" became ${slides.nodes.length} ${kindOf(shape)} slide${slides.nodes.length === 1 ? '' : 's'}.`,
        {
          severity: 'info',
          path: `/children/${at.index}`,
          context: { shape, slides: slides.nodes.length },
        }
      )
    );
  });

  return {
    children: children.flatMap(
      (slide, index) => replacements.get(index) ?? [slide]
    ),
    handled,
    diagnostics,
  };
}

/** What a section reads as, for the sentence "X reads as …". */
function describe(shape: Shape): string {
  return shape === 'none' ? 'a section' : SHAPES[shape].reads;
}

/** What the slides are, for the sentence "X became two … slides". */
function kindOf(shape: Shape): string {
  return shape === 'none' ? 'section' : SHAPES[shape].slides;
}

/** Fill a section into as many clones of `donor` as its content needs. */
function fill(
  donor: unknown,
  section: OutlineSection,
  content: Content,
  shape: Shape,
  definitions: Readonly<Record<string, JsonBlockDefinition>>
): { nodes: unknown[]; diagnostics: Diagnostic[]; titled: boolean } {
  const ref = refOf(donor);
  const takes = (slot: string) => listMax(definitions, ref, slot);
  // A table is one slide; a list decides how many its entries need.
  const list = shape === 'none' ? undefined : SHAPES[shape].list;
  const groups = list
    ? groupSizes(
        (list === 'items' ? content.facts : content.bullets).length,
        takes(list)
      )
    : [1];
  /** Whether the donor keeps a prose column beside whatever the shape fills. */
  const prose = typeof slotsOf(donor)?.text === 'string';

  let taken = 0;
  /** Whether every slide took the heading; a donor with no title takes none. */
  let titled = true;
  const nodes = groups.map((size, group) => {
    const node = structuredClone(donor);
    const slots = slotsOf(node);
    if (!slots) return node;
    // A split section says the same thing on each of its slides; the later
    // ones say so, rather than repeating the heading as if it were new.
    const heading =
      group === 0 ? section.heading : `${section.heading} (cont.)`;
    if (typeof slots.title === 'string') slots.title = heading;
    else if (typeof slots.assertion === 'string') slots.assertion = heading;
    if (content.source !== undefined && typeof slots.source === 'string')
      slots.source = content.source;

    if (list === 'items')
      slots.items = content.facts.slice(taken, taken + size).map(kpiItem);
    else if (list === 'bullets')
      slots.bullets = content.bullets.slice(taken, taken + size);
    taken += size;

    // The section's table goes on the slide the reader meets first.
    if (group === 0 && content.tables.length > 0 && isRecord(slots.content))
      setTable(slots.content, content.tables[0]);
    if (group === 0 && prose && content.paragraphs.length > 0)
      slots.text = content.paragraphs[0];
    return node;
  });

  const diagnostics: Diagnostic[] = [];
  const written = prose ? Math.min(1, content.paragraphs.length) : 0;
  const spare = content.paragraphs.length - written;
  if (spare > 0)
    diagnostics.push(
      unmapped(
        `"${section.heading}" became ${describe(shape)}, which has no room for ${spare} of its paragraph${spare === 1 ? '' : 's'}; they were not written.`,
        { paragraphs: spare }
      )
    );
  const spareTables =
    content.tables.length - (contentIs(nodes[0], 'table') ? 1 : 0);
  if (spareTables > 0)
    diagnostics.push(
      unmapped(
        `"${section.heading}" has ${content.tables.length} tables and a slide holds one; ${spareTables} of them ${spareTables === 1 ? 'was' : 'were'} not written.`,
        { tables: spareTables }
      )
    );
  return { nodes, diagnostics, titled };
}

function kpiItem(fact: NumericFact): Record<string, string> {
  return {
    value: fact.value,
    ...(fact.unit !== undefined && { unit: fact.unit }),
    label: fact.label,
    ...(fact.delta !== undefined && { delta: fact.delta }),
  };
}

/**
 * Write an outline table into a table component, keeping the donor's own
 * convention: the header row first, and a column right-aligned when every one
 * of its body cells is a number — which is what makes the numbers line up.
 */
function setTable(
  component: Record<string, unknown>,
  table: OutlineTable
): void {
  const props = isRecord(component.props) ? component.props : {};
  const numeric = table.headers.map(
    (_, column) =>
      table.rows.length > 0 &&
      table.rows.every((row) => isNumber(row[column] ?? ''))
  );
  const cell = (text: string, column: number) =>
    numeric[column] ? { text, align: 'right' } : text;
  props.rows = [
    table.headers.map(cell),
    ...table.rows.map((row) =>
      table.headers.map((_, column) => cell(row[column] ?? '', column))
    ),
  ];
  component.props = props;
}

/** A cell that reads as a measurement: digits, with a sign, unit or separators. */
function isNumber(cell: string): boolean {
  return /^[+\-−(]?\s*[€$£]?\s*\d[\d.,\s]*\s*[%€$£A-Za-z]{0,4}\)?$/.test(
    cell.trim()
  );
}

function unmapped(
  message: string,
  context: Record<string, unknown>,
  path?: string
): Diagnostic {
  return diagnostic(ERROR_CODES.OUTLINE_UNMAPPED, message, {
    severity: 'warning',
    ...(path !== undefined && { path }),
    suggestion:
      'Add sections or paragraphs with jto_workspace_patch, pick a longer variant, or fold the outline into the structure the variant has.',
    context,
  });
}
