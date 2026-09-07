/**
 * The block boundary matrix (#343, report portion): every JSON block
 * definition a playground template embeds, invoked at the edges of its own
 * slot schema — minimum and maximum cardinality, every string at its word
 * budget, every figure at its widest — on each bundled theme, with the
 * design fonts and with the fallback faces LibreOffice substitutes when a
 * host lacks them, on A4 and on Letter.
 *
 * The generator is pure and reads nothing but the template it is handed:
 * a definition gains coverage by being embedded, never by being listed here.
 * What the suites do with a case — the static rules under the archetype's
 * profile, the rendered pass over the LibreOffice PDF — is theirs; this
 * module only says what a boundary document is.
 *
 * Two shapes come out. A *block case* is a small report — cover, running
 * head, section opener — with one block at an edge in the body, so a
 * finding names the block that caused it. A *report case* is the template's
 * own document with every invocation at that edge, so the blocks meet each
 * other the way they do in a real report. Both carry their definitions and
 * dependencies inline, so nothing is resolved at render time.
 */

import {
  blockDependencies,
  readBlockDefinitions,
  type BlockSlot,
  type JsonBlockDefinition,
} from '@json-to-office/shared';

type Rec = Record<string, unknown>;

export type MatrixEdge = 'min' | 'max';
export type MatrixFont = 'design' | 'fallback';
export type MatrixCanvas = 'A4' | 'LETTER';

export interface BlockMatrixDefinition {
  name: string;
  /** The template the definition is embedded in, as the catalog names it. */
  template: string;
  /** Where inside that template: `/props/blocks/<name>`. */
  pointer: string;
  definition: JsonBlockDefinition;
  /** The template's own first invocation, when it has one: the nominal fill. */
  example?: Rec;
}

export interface BlockMatrixCase {
  id: string;
  /** The block at its edge, or `report` for the whole template at that edge. */
  block: string;
  edge: MatrixEdge;
  theme: string;
  font: MatrixFont;
  canvas: MatrixCanvas;
  document: Rec;
}

export interface BlockMatrixOptions {
  themes: readonly string[];
  fonts?: readonly MatrixFont[];
  edges?: readonly MatrixEdge[];
  canvases?: readonly MatrixCanvas[];
  /** Whether the whole-template report cases are generated. Default true. */
  report?: boolean;
  /** Whether the per-block cases are generated. Default true. */
  blocks?: boolean;
  /**
   * Slot roles the profile under test requires present, so `min` keeps them:
   * the client-report profile's `takeaway` and `source`.
   */
  requiredRoles?: readonly string[];
}

export interface CaseConditions {
  font?: MatrixFont;
  canvas?: MatrixCanvas;
  requiredRoles?: readonly string[];
}

/**
 * The face every LibreOffice ships with, bundled inside the application on
 * each platform: what a design font degrades to when the host lacks it, and
 * wider than Arial or Calibri, so a fit at these metrics is a fit anywhere.
 * Only the roles a report paints are overridden: a family declared for a
 * role nothing uses is never embedded, and the rendered pass would report
 * it as substituted.
 */
export const FALLBACK_FONTS = {
  heading: { family: 'DejaVu Sans' },
  body: { family: 'DejaVu Sans' },
} as const;

/** A 4x2 PNG: an image with an aspect ratio, and no bytes outside the process. */
export const MATRIX_IMAGE =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAACCAYAAABytg0kAAAAFElEQVR42mNk+M9QzwAFjDAGACPuA/8fMSCgAAAAAElFTkSuQmCC';

/**
 * Words of the length a report actually uses, so a budget of N words costs
 * what N report words cost — "a b c" at the limit proves nothing.
 */
const WORDS = [
  'performance',
  'delivery',
  'retention',
  'operating',
  'programme',
  'contracted',
  'recommendation',
  'quarter',
  'measurement',
  'ownership',
  'renewal',
  'segment',
  'margin',
  'baseline',
  'procurement',
  'integration',
];

/**
 * `count` words from the lexicon, starting at `seed`. The first word is the
 * seed's ordinal spelt as a word-length token (`item7`), so no two strings
 * from different seeds share a run of words: the rendered pass matches
 * authored strings against the page text, and two slots that read the
 * same would claim each other's occurrences.
 */
function words(count: number, seed: number, sentence: boolean): string {
  if (count <= 0) return '';
  const out: string[] = [`Item${seed}`];
  for (let i = 1; i < count; i += 1) out.push(WORDS[(seed + i) % WORDS.length]);
  return sentence ? `${out.join(' ')}.` : out.join(' ');
}

/**
 * The widest number of a given length: a true minus, thousands separators
 * and one decimal, every glyph at tabular width. `−1,234,567.0` for 12.
 */
export function widestNumber(length: number, seed = 0): string {
  if (length <= 0) return '';
  if (length === 1) return '9';
  if (length < 4) return `−${'9'.repeat(length - 1)}`;
  const group = (digits: number): string =>
    Array.from({ length: digits }, (_, i) => String(((i + seed) % 9) + 1))
      .join('')
      .replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  // The most digits whose grouped form still leaves room for `−` and `.0`;
  // the decimals then grow to the exact length when a comma boundary
  // makes the next digit cost two.
  let digits = 1;
  while (group(digits + 1).length + 3 <= length) digits += 1;
  const integer = group(digits);
  return `−${integer}.${'0'.repeat(length - integer.length - 2)}`;
}

const isRecord = (v: unknown): v is Rec =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Slot names whose strings are figures, not prose. */
const NUMERIC_SLOTS = new Set(['value', 'delta', 'cells']);

function stringValue(
  slot: BlockSlot,
  name: string,
  edge: MatrixEdge,
  seed: number
): string {
  if (slot.enum && slot.enum.length > 0) {
    const values = slot.enum.map(String);
    return edge === 'max'
      ? values.reduce((a, b) => (b.length > a.length ? b : a))
      : values[0];
  }
  if (slot.maxLength !== undefined && NUMERIC_SLOTS.has(name)) {
    return widestNumber(
      edge === 'max' ? slot.maxLength : Math.min(3, slot.maxLength),
      seed
    );
  }
  if (slot.maxLength !== undefined && name === 'unit') {
    return edge === 'max'
      ? ` €${'m'.repeat(Math.max(0, slot.maxLength - 2))}`.slice(
          0,
          slot.maxLength
        )
      : '%';
  }
  if (slot.maxLength !== undefined) {
    const target =
      edge === 'max' ? slot.maxLength : Math.max(1, slot.minLength ?? 1);
    // Whole words up to the length: a word cut in two is not a word a
    // report would print, and the rendered pass would go looking for it.
    let text = `Item${seed}`.slice(0, target);
    let i = 0;
    for (;;) {
      const next = WORDS[(seed + i) % WORDS.length];
      i += 1;
      if (text.length + 1 + next.length > target) {
        if (i > WORDS.length) break;
        continue;
      }
      text += ` ${next}`;
    }
    return text;
  }
  const budget = slot.maxWords ?? 12;
  const count = edge === 'max' ? budget : Math.max(1, Math.min(2, budget));
  const sentence = !slot.oneLine && slot.role !== 'source';
  if (slot.role === 'source') return `Source: ${words(count - 1, seed, false)}`;
  if (name === 'number')
    return edge === 'max' ? words(count, seed, false) : '01';
  return words(count, seed, sentence);
}

function componentValue(name: string, edge: MatrixEdge, seed: number): Rec {
  if (name === 'chart') {
    const categories = edge === 'max' ? 8 : 2;
    const series = edge === 'max' ? 3 : 1;
    return {
      name: 'chart',
      props: {
        type: 'column',
        valAxisTitle:
          edge === 'max' ? `${words(3, seed, false)} (€m)` : 'Revenue (€m)',
        ...(edge === 'max' && { catAxisTitle: words(3, seed + 3, false) }),
        chartColors: ['primary', 'secondary', 'accent'].slice(0, series),
        data: Array.from({ length: series }, (_, s) => ({
          name: words(edge === 'max' ? 3 : 1, seed + s, false),
          // Two words per category is where LibreOffice's native chart
          // still keeps rotated labels clear of the axis title; at three
          // the title is drawn over them, at any category count.
          labels: Array.from({ length: categories }, (_, c) =>
            edge === 'max' ? words(2, seed + c, false) : `Q${c + 1}`
          ),
          values: Array.from(
            { length: categories },
            (_, c) => 1.2 * (c + 1) + s
          ),
        })),
      },
    };
  }
  return {
    name: 'image',
    props: {
      base64: MATRIX_IMAGE,
      width: edge === 'max' ? (name === 'logo' ? '40%' : '100%') : '25%',
      alt: words(6, seed, false),
    },
  };
}

/** A slot's value at an edge; `undefined` means "leave it out". */
export function boundarySlotValue(
  slot: BlockSlot,
  name: string,
  edge: MatrixEdge,
  seed = 0
): unknown {
  switch (slot.type) {
    case 'string':
      return stringValue(slot, name, edge, seed);
    case 'number':
    case 'integer':
      return edge === 'max' ? slot.maximum ?? 9999 : slot.minimum ?? 0;
    case 'boolean':
      return edge === 'max' ? true : slot.default ?? true;
    case 'component':
      return componentValue(name, edge, seed);
    case 'object': {
      const out: Rec = {};
      for (const [key, property] of Object.entries(slot.properties ?? {})) {
        if (edge === 'min' && !property.required) continue;
        const value = boundarySlotValue(property, key, edge, seed + key.length);
        if (value !== undefined) out[key] = value;
      }
      return out;
    }
    case 'array': {
      const count =
        edge === 'max'
          ? slot.maxItems ?? 3
          : slot.minItems ?? (slot.required ? 1 : 0);
      const item = slot.items ?? { type: 'string' };
      return Array.from({ length: count }, (_, i) =>
        boundarySlotValue(item, name, edge, seed + i)
      );
    }
    default:
      return undefined;
  }
}

/**
 * One invocation of a definition with every slot at the edge: optional slots
 * left out at `min` (so defaults are what renders), every slot at `max`.
 * A slot whose role the profile requires — a source under every figure —
 * is never optional to that profile, so `requiredRoles` keeps it at `min`.
 * Columns whose cells must count the rows do; nothing else knows a block.
 */
export function boundaryInvocation(
  name: string,
  definition: JsonBlockDefinition,
  edge: MatrixEdge,
  seed = 0,
  requiredRoles: readonly string[] = []
): Rec {
  const slots: Rec = {};
  let offset = seed;
  for (const [slotName, slot] of Object.entries(definition.slots)) {
    offset += slotName.length;
    const required =
      slot.required === true ||
      (slot.role !== undefined && requiredRoles.includes(slot.role));
    if (edge === 'min' && !required) continue;
    const value = boundarySlotValue(slot, slotName, edge, offset);
    if (value !== undefined) slots[slotName] = value;
  }
  const labels = slots.labels;
  const columns = slots.columns;
  if (Array.isArray(labels) && Array.isArray(columns)) {
    const cells = definition.slots.columns?.items?.properties?.cells;
    for (const column of columns) {
      if (isRecord(column) && Array.isArray(column.cells) && cells?.items) {
        column.cells = labels.map((_, i) =>
          boundarySlotValue(cells.items as BlockSlot, 'cells', edge, offset + i)
        );
      }
    }
  }
  return { name: 'block', props: { ref: name, slots } };
}

/**
 * The same invocation one past the edge: the first budgeted string a word
 * over, or the first bounded array an item over. What a slot violation
 * looks like, so a suite can prove it is reported at the authored pointer.
 */
export function overBudgetInvocation(
  name: string,
  definition: JsonBlockDefinition,
  seed = 0
): { invocation: Rec; slot: string; kind: 'words' | 'items' } | undefined {
  const invocation = boundaryInvocation(name, definition, 'max', seed);
  const slots = (invocation.props as Rec).slots as Rec;
  for (const [slotName, slot] of Object.entries(definition.slots)) {
    if (slot.type === 'string' && slot.maxWords !== undefined) {
      slots[slotName] = `${words(slot.maxWords + 1, seed, !slot.oneLine)}`;
      return { invocation, slot: slotName, kind: 'words' };
    }
  }
  for (const [slotName, slot] of Object.entries(definition.slots)) {
    if (
      slot.type === 'array' &&
      slot.maxItems !== undefined &&
      Array.isArray(slots[slotName])
    ) {
      const items = slots[slotName] as unknown[];
      slots[slotName] = [...items, items[0]];
      return { invocation, slot: slotName, kind: 'items' };
    }
  }
  return undefined;
}

/** Every definition a template embeds, with the template's own example of it. */
export function enumerateBlockDefinitions(
  template: unknown,
  templateName: string
): BlockMatrixDefinition[] {
  const definitions = readBlockDefinitions(template);
  const examples = new Map<string, Rec>();
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (!isRecord(node)) return;
    const props = node.props;
    if (
      node.name === 'block' &&
      isRecord(props) &&
      typeof props.ref === 'string' &&
      !examples.has(props.ref)
    ) {
      examples.set(props.ref, isRecord(props.slots) ? props.slots : {});
    }
    walk(node.children);
  };
  walk(isRecord(template) ? template.children : undefined);
  return Object.entries(definitions).map(([name, definition]) => ({
    name,
    template: templateName,
    pointer: `/props/blocks/${name.replace(/~/g, '~0').replace(/\//g, '~1')}`,
    definition,
    ...(examples.has(name) && { example: examples.get(name) }),
  }));
}

/** The block names a report's chrome is made of, when the template has them. */
const CHROME = ['cover', 'running-head', 'section-opener'] as const;

function nominal(
  entry: BlockMatrixDefinition | undefined,
  name: string,
  definitions: Record<string, JsonBlockDefinition>
): Rec | undefined {
  if (!entry) return undefined;
  if (entry.example) {
    return {
      name: 'block',
      props: { ref: name, slots: structuredClone(entry.example) },
    };
  }
  return boundaryInvocation(name, definitions[name], 'min');
}

/** The template's own image slot values point at files; the matrix inlines. */
function inlineImages(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(inlineImages);
  if (!isRecord(value)) return value;
  if (
    value.name === 'image' &&
    isRecord(value.props) &&
    typeof value.props.path === 'string'
  ) {
    const props: Rec = { ...value.props, base64: MATRIX_IMAGE };
    delete props.path;
    return { ...value, props };
  }
  if (value.name === 'highcharts') return componentValue('chart', 'min', 0);
  return Object.fromEntries(
    Object.entries(value).map(([k, v]) => [k, inlineImages(v)])
  );
}

function withDefinitions(
  definitions: Record<string, JsonBlockDefinition>,
  names: Iterable<string>
): Record<string, JsonBlockDefinition> {
  const out: Record<string, JsonBlockDefinition> = {};
  for (const name of names) {
    if (!(name in definitions)) continue;
    out[name] = definitions[name];
    for (const dependency of blockDependencies(definitions, name)) {
      if (dependency in definitions) out[dependency] = definitions[dependency];
    }
  }
  return out;
}

function conditions(
  props: Rec,
  children: unknown[],
  theme: string,
  font: MatrixFont,
  canvas: MatrixCanvas
): Rec {
  // Every section takes the canvas, keeping whatever else its own page
  // override says (a template section can state margins of its own).
  const sections = children.map((child) => {
    if (!isRecord(child) || child.name !== 'section') return child;
    const props = isRecord(child.props) ? child.props : {};
    const page = isRecord(props.page) ? props.page : {};
    return { ...child, props: { ...props, page: { ...page, size: canvas } } };
  });
  // A native chart is drawn by the office-open renderer only.
  const chart = JSON.stringify(sections).includes('"name":"chart"');
  return {
    name: 'docx',
    ...(chart && { renderer: 'office-open' }),
    props: {
      ...props,
      theme,
      ...(font === 'fallback' && { themeOverrides: { fonts: FALLBACK_FONTS } }),
    },
    children: sections,
  };
}

// A seed no slot offset reaches (offsets are sums of slot-name lengths):
// body copy must not read as the prefix of any slot's text, or the matcher
// could map a dropped title onto the paragraph after it.
const BODY_COPY = words(40, 1000, true);

/**
 * A small report with one block at its edge: the chrome at the template's
 * nominal values (or at the edge, when the chrome block is the one under
 * test), the block in the first body section, body copy after it.
 */
export function blockCaseDocument(
  entries: readonly BlockMatrixDefinition[],
  name: string,
  edge: MatrixEdge,
  theme: string,
  { font = 'design', canvas = 'A4', requiredRoles = [] }: CaseConditions = {}
): Rec {
  const definitions = Object.fromEntries(
    entries.map((e) => [e.name, e.definition])
  );
  const byName = new Map(entries.map((e) => [e.name, e]));
  const under = (chrome: string): Rec | undefined =>
    chrome === name
      ? boundaryInvocation(name, definitions[name], edge, 0, requiredRoles)
      : (inlineImages(nominal(byName.get(chrome), chrome, definitions)) as
          | Rec
          | undefined);
  const cover = under('cover');
  const runningHead = under('running-head');
  const opener = under('section-opener');
  const body: unknown[] = [];
  if (!CHROME.includes(name as (typeof CHROME)[number])) {
    // A notes block collects sources: give it a figure to collect from.
    if (name === 'footnotes' && byName.has('figure')) {
      body.push(
        inlineImages(nominal(byName.get('figure'), 'figure', definitions))
      );
    }
    body.push(
      boundaryInvocation(name, definitions[name], edge, 0, requiredRoles)
    );
  }
  body.push({ name: 'paragraph', props: { text: BODY_COPY } });
  const used = new Set<string>([
    name,
    ...CHROME,
    ...(name === 'footnotes' ? ['figure'] : []),
  ]);
  const children: unknown[] = [];
  if (cover) children.push({ name: 'section', children: [cover] });
  children.push({
    name: 'section',
    children: [runningHead, opener, ...body].filter((c) => c !== undefined),
  });
  return conditions(
    {
      metadata: {
        title: 'Boundary report',
        author: 'jto-ops block matrix',
        company: 'Example client',
        date: 'September 2026',
      },
      blocks: withDefinitions(definitions, used),
    },
    children,
    theme,
    font,
    canvas
  );
}

/** The whole template with every invocation at the edge. */
export function reportCaseDocument(
  template: unknown,
  edge: MatrixEdge,
  theme: string,
  { font = 'design', canvas = 'A4', requiredRoles = [] }: CaseConditions = {}
): Rec {
  if (!isRecord(template) || !isRecord(template.props))
    throw new Error('A template is a document with props.');
  const definitions = readBlockDefinitions(template);
  let seed = 0;
  const rewrite = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(rewrite);
    if (!isRecord(node)) return node;
    const props = node.props;
    if (
      node.name === 'block' &&
      isRecord(props) &&
      typeof props.ref === 'string' &&
      definitions[props.ref]
    ) {
      seed += 7;
      return boundaryInvocation(
        props.ref,
        definitions[props.ref],
        edge,
        seed,
        requiredRoles
      );
    }
    if (
      node.name === 'paragraph' &&
      isRecord(props) &&
      typeof props.text === 'string'
    ) {
      return {
        ...node,
        props: { ...props, text: edge === 'max' ? BODY_COPY : props.text },
      };
    }
    return Array.isArray(node.children)
      ? { ...node, children: rewrite(node.children) }
      : node;
  };
  const props: Rec = structuredClone(template.props);
  delete props.theme;
  delete props.themeOverrides;
  return conditions(
    props,
    rewrite(template.children) as unknown[],
    theme,
    font,
    canvas
  );
}

/** Every case the options span, in a stable order. */
export function generateBlockMatrix(
  template: unknown,
  templateName: string,
  options: BlockMatrixOptions
): BlockMatrixCase[] {
  const entries = enumerateBlockDefinitions(template, templateName);
  const fonts = options.fonts ?? ['design', 'fallback'];
  const edges = options.edges ?? ['min', 'max'];
  const canvases = options.canvases ?? ['A4'];
  const cases: BlockMatrixCase[] = [];
  for (const theme of options.themes)
    for (const font of fonts)
      for (const canvas of canvases)
        for (const edge of edges) {
          if (options.blocks !== false)
            for (const entry of entries)
              cases.push({
                id: `${entry.name}@${edge}/${theme}/${font}/${canvas}`,
                block: entry.name,
                edge,
                theme,
                font,
                canvas,
                document: blockCaseDocument(entries, entry.name, edge, theme, {
                  font,
                  canvas,
                  requiredRoles: options.requiredRoles,
                }),
              });
          if (options.report !== false)
            cases.push({
              id: `report@${edge}/${theme}/${font}/${canvas}`,
              block: 'report',
              edge,
              theme,
              font,
              canvas,
              document: reportCaseDocument(template, edge, theme, {
                font,
                canvas,
                requiredRoles: options.requiredRoles,
              }),
            });
        }
  return cases;
}
