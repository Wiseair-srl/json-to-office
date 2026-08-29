/**
 * Unknown-key guard (#292): every closed object position in every standard
 * component's props must reject an unknown key through BOTH entry points —
 * the standalone validators and generation-time validation — with agreeing
 * verdicts and a localized (non-root) diagnostic.
 *
 * This generalizes validate-generate-agreement.test.ts beyond table cell
 * fonts. The positions are enumerated from the live props schemas (a registry
 * entry's `createPropsSchema` factory probed with a marker, or its static
 * schema), so a prop object added to any component is swept automatically —
 * a deep-walk blind spot fails here instead of shipping as a silent
 * fail-open acceptance.
 *
 * The second suite embeds a defective paragraph at every component-embedding
 * position (children chains, section header/footer, table cell content): the
 * historical blind-spot class (2dff712) that motivated the registry-driven
 * walk.
 *
 * Agreement is asserted in the REJECT direction only: baselines are checked
 * against the validators but never generated, because generating ~300
 * accepted documents would exercise real renderers (fonts, rasterization)
 * for no schema signal. The accept direction rests on validate and
 * generation sharing one function (542f8ad) and is exercised with real
 * generation by validate-generate-agreement.test.ts.
 */
import { describe, it, expect } from 'vitest';
import { Type, type TSchema } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import {
  STANDARD_COMPONENTS_REGISTRY,
  validate,
  validateStrict,
} from '@json-to-office/shared-docx';
import { generateBufferFromJson } from '../generator';
import { JsonValidationError } from '../../json/parser';

type Json = Record<string, unknown>;

const MARKER = Type.Object({}, { $id: '__component_marker__' });
const PLACEHOLDER_COMPONENT: Json = { name: 'paragraph', props: { text: 'x' } };
const PROBE_KEY = 'zzUnknownProbeKey';

// ---------------------------------------------------------------------------
// Position enumeration: every additionalProperties:false object in a schema.
// ---------------------------------------------------------------------------

/** `*` stands for "an element of the array at this position". */
type PositionPath = readonly string[];

function enumerateClosedObjects(schema: TSchema): PositionPath[] {
  const found = new Map<string, PositionPath>();

  const visit = (
    node: any,
    path: PositionPath,
    depth: number,
    seenIds: readonly string[]
  ): void => {
    if (!node || typeof node !== 'object' || node === MARKER) return;
    if (depth > 12) return;
    // A `$ref` is a recursive self-reference (list items, cell content): the
    // referenced component's own sweep covers its interior.
    if (node.$ref) return;
    if (node.$id) {
      if (seenIds.includes(node.$id)) return;
      seenIds = [...seenIds, node.$id];
    }
    if (Array.isArray(node.anyOf)) {
      for (const branch of node.anyOf) visit(branch, path, depth + 1, seenIds);
      return;
    }
    if (node.type === 'object' && node.properties) {
      if (node.additionalProperties === false) {
        found.set(path.join('/'), path);
      }
      for (const [key, child] of Object.entries(node.properties)) {
        visit(child, [...path, key], depth + 1, seenIds);
      }
      return;
    }
    if (node.items) visit(node.items, [...path, '*'], depth + 1, seenIds);
  };

  visit(schema, [], 0, []);
  return [...found.values()];
}

// ---------------------------------------------------------------------------
// Minimal-instance builder: a valid value for a schema that materializes the
// given path. Throws with a reason when it cannot — the test surfaces that as
// a loud failure so the builder is extended instead of silently skipping.
// ---------------------------------------------------------------------------

const CANDIDATE_STRINGS = [
  'x',
  'n1',
  '#123456',
  '10%',
  '10pt',
  'https://example.com/x',
] as const;

function sampleForPattern(pattern: string): string {
  const regex = new RegExp(pattern);
  const match = CANDIDATE_STRINGS.find((candidate) => regex.test(candidate));
  if (match !== undefined) return match;
  throw new Error(`no sample string for pattern ${pattern}`);
}

/**
 * `terminalObject` — the value at the END of `includePath` is the probe
 * target and must come out as a plain object: union branches that would put a
 * primitive there (a `width: number | {...}` union built as the number) are
 * skipped in favor of an object branch.
 */
function buildValue(
  schema: any,
  includePath: PositionPath,
  terminalObject = false
): unknown {
  if (!schema || typeof schema !== 'object') {
    throw new Error('missing schema');
  }
  if (schema === MARKER) return structuredClone(PLACEHOLDER_COMPONENT);
  if (schema.$ref) {
    throw new Error('cannot build a recursive $ref value');
  }
  const atTerminal = includePath.length === 0 && terminalObject;
  if ('const' in schema) {
    if (atTerminal) throw new Error('terminal is a literal, not an object');
    return schema.const;
  }
  if (Array.isArray(schema.enum)) {
    if (atTerminal) throw new Error('terminal is an enum, not an object');
    return schema.enum[0];
  }

  if (Array.isArray(schema.anyOf)) {
    const reasons: string[] = [];
    for (const branch of schema.anyOf) {
      try {
        const candidate = buildValue(branch, includePath, terminalObject);
        if (Value.Check(branch, candidate)) return candidate;
        reasons.push('built candidate failed its own branch check');
      } catch (error) {
        reasons.push(error instanceof Error ? error.message : String(error));
      }
    }
    throw new Error(`no union branch buildable (${reasons.join('; ')})`);
  }

  if (atTerminal && schema.type !== 'object') {
    throw new Error(`terminal has type ${schema.type}, not object`);
  }
  if (
    includePath.length > 0 &&
    schema.type !== 'object' &&
    schema.type !== 'array'
  ) {
    // A primitive cannot carry the rest of the path — refuse instead of
    // returning a value the probe injection would then miss (matters inside
    // unions like `number | { … }`, where the object branch owns the path).
    throw new Error(`cannot materialize a path inside type ${schema.type}`);
  }

  const [head, ...rest] = includePath;

  switch (schema.type) {
    case 'string': {
      if (schema.default !== undefined) return schema.default;
      if (Array.isArray(schema.examples) && schema.examples.length > 0) {
        return schema.examples[0];
      }
      if (schema.pattern) return sampleForPattern(schema.pattern);
      if (schema.format === 'uri') return 'https://example.com/x';
      const min = schema.minLength ?? 1;
      return 'x'.repeat(Math.max(1, min));
    }
    case 'number':
    case 'integer': {
      let n: number =
        schema.default ??
        schema.minimum ??
        (schema.exclusiveMinimum !== undefined
          ? schema.exclusiveMinimum + 1
          : 1);
      if (schema.multipleOf) {
        n = Math.ceil(n / schema.multipleOf) * schema.multipleOf;
      }
      if (schema.maximum !== undefined) n = Math.min(n, schema.maximum);
      if (schema.type === 'integer') n = Math.ceil(n);
      return n;
    }
    case 'boolean':
      return schema.default ?? true;
    case 'array': {
      if (head === '*') {
        // First element materializes the path; pad to minItems (gradient
        // stops require two, for example).
        const first = buildValue(schema.items, rest, terminalObject);
        const padding = Math.max(0, (schema.minItems ?? 1) - 1);
        return [
          first,
          ...Array.from({ length: padding }, () =>
            buildValue(schema.items, [])
          ),
        ];
      }
      const count = schema.minItems ?? 0;
      return Array.from({ length: count }, () => buildValue(schema.items, []));
    }
    case 'object': {
      if (!schema.properties) {
        if (head !== undefined) {
          throw new Error('cannot materialize a path inside an open object');
        }
        return {};
      }
      const value: Json = {};
      const required: string[] = schema.required ?? [];
      for (const key of required) {
        if (key === head) continue;
        value[key] = buildValue(schema.properties[key], []);
      }
      if (head !== undefined) {
        const child = schema.properties[head];
        if (!child) throw new Error(`no property "${head}" to materialize`);
        value[head] = buildValue(child, rest, terminalObject);
      }
      return value;
    }
    default:
      // Type.Any / unrecognized: only safe as a leaf.
      if (head !== undefined) {
        throw new Error('cannot materialize a path inside an untyped schema');
      }
      return 'x';
  }
}

/** Deep-set the probe key at `path` ('*' resolves to index 0). */
function injectProbe(value: unknown, path: PositionPath): unknown {
  const clone = structuredClone(value) as any;
  let cursor = clone;
  for (const segment of path) {
    cursor = segment === '*' ? cursor[0] : cursor[segment];
  }
  cursor[PROBE_KEY] = 1;
  return clone;
}

// ---------------------------------------------------------------------------
// Document wrappers and the three-way verdict.
// ---------------------------------------------------------------------------

/**
 * Wrap a component instance into a whole document. `chart` and `visual` need
 * the `office-open` renderer to validate without `unsupported_renderer_feature`
 * noise; everything else stays on the default `docxjs` — office-open has gaps
 * of its own (it rejects comment threads, which several props sweeps hit).
 */
const OFFICE_OPEN_ONLY = new Set(['chart', 'visual']);

function componentDoc(name: string, props: unknown): Json {
  const renderer = OFFICE_OPEN_ONLY.has(name)
    ? { renderer: 'office-open' }
    : {};
  if (name === 'docx') {
    return { name: 'docx', ...renderer, props, children: [] };
  }
  const component: Json = { name, props };
  return {
    name: 'docx',
    ...renderer,
    props: { theme: 'minimal' },
    children:
      name === 'section'
        ? [component]
        : [{ name: 'section', children: [component] }],
  };
}

async function generationVerdict(
  doc: Json
): Promise<'accepted' | 'rejected-by-validation' | 'failed-otherwise'> {
  try {
    await generateBufferFromJson(doc as never);
    return 'accepted';
  } catch (error) {
    return error instanceof JsonValidationError
      ? 'rejected-by-validation'
      : 'failed-otherwise';
  }
}

/** Baseline must validate; the injected document must be refused everywhere. */
async function expectGuarded(
  label: string,
  baseline: Json,
  injected: Json
): Promise<void> {
  const baseResult = validate.jsonDocument(JSON.stringify(baseline));
  expect(
    { label, valid: baseResult.valid, errors: baseResult.errors ?? [] },
    `baseline for ${label} must be valid — fix the test builder, not the guard`
  ).toEqual({ label, valid: true, errors: [] });

  const lenient = validate.jsonDocument(JSON.stringify(injected));
  const strict = validateStrict.jsonDocument(JSON.stringify(injected));
  const generation = await generationVerdict(injected);

  expect({
    label,
    lenient: lenient.valid,
    strict: strict.valid,
    generation,
  }).toEqual({
    label,
    lenient: false,
    strict: false,
    generation: 'rejected-by-validation',
  });

  // The rejection must be localized: a root-only generic error means the
  // deep walk never saw the position and the fail-closed net caught it —
  // the verdict survives, but the author is left without a usable path.
  const localized = (lenient.errors ?? []).some(
    (e) => e.path && e.path !== 'root' && e.path !== '/'
  );
  expect(
    localized,
    `expected a non-root error path for ${label}, got: ${JSON.stringify(lenient.errors)}`
  ).toBe(true);
}

// ---------------------------------------------------------------------------
// Sweep 1: every closed object position of every component's props.
// ---------------------------------------------------------------------------

describe('unknown keys are rejected at every closed props position', () => {
  it.each(STANDARD_COMPONENTS_REGISTRY.map((c) => [c.name, c] as const))(
    '%s',
    async (name, component) => {
      const liveProps = component.createPropsSchema
        ? component.createPropsSchema(MARKER)
        : component.propsSchema;

      const positions = enumerateClosedObjects(liveProps);
      // highcharts is the one deliberately open props surface (a Highcharts
      // config passthrough) — every other component must expose at least one
      // closed object, or the whole sweep silently degrades to a no-op.
      if (name !== 'highcharts') {
        expect(positions.length).toBeGreaterThan(0);
      }

      for (const path of positions) {
        const label = `${name} props/${path.join('/') || '(root)'}`;
        let baselineProps: unknown;
        try {
          baselineProps = buildValue(liveProps, path, true);
        } catch (error) {
          throw new Error(
            `could not build a valid instance for ${label}: ${
              error instanceof Error ? error.message : error
            }`
          );
        }
        await expectGuarded(
          label,
          componentDoc(name, baselineProps),
          componentDoc(name, injectProbe(baselineProps, path))
        );
      }
    },
    120_000
  );
});

// ---------------------------------------------------------------------------
// Sweep 2: a defective component at every embedding position.
// ---------------------------------------------------------------------------

describe('a defective component is rejected at every embedding position', () => {
  const paragraph = (extra?: Json): Json => ({
    name: 'paragraph',
    props: { text: 'x', ...extra },
  });

  const doc = (children: unknown[]): Json => ({
    name: 'docx',
    props: { theme: 'minimal' },
    children,
  });

  /** Each embedding builds the same document around a paragraph payload. */
  const EMBEDDINGS: Record<string, (p: Json) => Json> = {
    'root children': (p) => doc([p]),
    'section children': (p) => doc([{ name: 'section', children: [p] }]),
    'columns children': (p) =>
      doc([
        {
          name: 'section',
          children: [
            { name: 'columns', props: { columns: 2 }, children: [p, p] },
          ],
        },
      ]),
    'text-box children': (p) =>
      doc([
        { name: 'section', children: [{ name: 'text-box', children: [p] }] },
      ]),
    'text-box nested in columns': (p) =>
      doc([
        {
          name: 'section',
          children: [
            {
              name: 'columns',
              props: { columns: 2 },
              children: [{ name: 'text-box', children: [p] }, p],
            },
          ],
        },
      ]),
    'section header': (p) =>
      doc([{ name: 'section', props: { header: [p] }, children: [] }]),
    'section footer': (p) =>
      doc([{ name: 'section', props: { footer: [p] }, children: [] }]),
    'table column header content': (p) =>
      doc([
        {
          name: 'section',
          children: [
            {
              name: 'table',
              props: {
                columns: [
                  { header: { content: p }, cells: [{ content: 'A' }] },
                ],
              },
            },
          ],
        },
      ]),
    'table cell content': (p) =>
      doc([
        {
          name: 'section',
          children: [
            {
              name: 'table',
              props: {
                columns: [
                  { header: { content: 'H' }, cells: [{ content: p }] },
                ],
              },
            },
          ],
        },
      ]),
  };

  it.each(Object.entries(EMBEDDINGS))(
    '%s',
    async (label, build) => {
      await expectGuarded(
        label,
        build(paragraph()),
        build(paragraph({ [PROBE_KEY]: 1 }))
      );
    },
    60_000
  );

  // The same positions again, with the junk key NEXT TO name/props instead of
  // inside props — the position no per-component props check ever sees, and
  // the exact fail-open hole that motivated #292's rescue audit.
  it.each(Object.entries(EMBEDDINGS))(
    '%s (sibling key)',
    async (label, build) => {
      const sibling = { ...paragraph(), [PROBE_KEY]: 1 };
      await expectGuarded(
        `${label} (sibling)`,
        build(paragraph()),
        build(sibling)
      );
    },
    60_000
  );

  it('rejects an unknown key on the document root itself', async () => {
    const baseline = doc([paragraph()]);
    await expectGuarded('document root sibling', baseline, {
      ...baseline,
      [PROBE_KEY]: 1,
    });
  }, 60_000);
});
