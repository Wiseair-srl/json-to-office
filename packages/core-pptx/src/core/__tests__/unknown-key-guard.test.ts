/**
 * Unknown-key guard, pptx (#292 parity): every closed object position in
 * every standard component's props must reject an unknown key through BOTH
 * entry points — the standalone validators and generation-time validation —
 * with agreeing verdicts and a localized (non-root) diagnostic.
 *
 * Unlike docx, pptx has no whole-document TypeBox stage: the deep walk IS the
 * validator, so a walk blind spot fails open directly (accepted and rendered)
 * with no fail-closed net behind it. This sweep is that net, at test time:
 * positions are enumerated from the registry's props schemas, so a prop
 * object added to any component is swept automatically.
 *
 * The second suite plants a defective component at every embedding position
 * (root children, slide children, slide placeholders) — in the props, as an
 * unknown sibling key, and as a wrong-typed known sibling key (`enabled:
 * "yes"`), the class the walk historically missed because it checked key
 * presence but not value type.
 *
 * Agreement is asserted in the REJECT direction only: baselines are checked
 * against the validators but never generated, mirroring the docx guard —
 * generation shares assertValidPresentationForGeneration with the
 * validators, and rendering accepted decks here would buy no schema signal.
 */
import { describe, it, expect } from 'vitest';
import { Value } from '@sinclair/typebox/value';
import {
  PPTX_STANDARD_COMPONENTS_REGISTRY,
  validate,
  validateStrict,
} from '@json-to-office/shared-pptx';
import { generateBufferFromJson } from '../generator';
import { PresentationValidationError } from '../generationOptions';

type Json = Record<string, unknown>;

const PROBE_KEY = 'zzUnknownProbeKey';

// ---------------------------------------------------------------------------
// Position enumeration: every additionalProperties:false object in a schema.
// ---------------------------------------------------------------------------

/** `*` stands for "an element of the array at this position". */
type PositionPath = readonly string[];

function enumerateClosedObjects(schema: unknown): PositionPath[] {
  const found = new Map<string, PositionPath>();

  const visit = (
    node: any,
    path: PositionPath,
    depth: number,
    seenIds: readonly string[]
  ): void => {
    if (!node || typeof node !== 'object') return;
    if (depth > 12) return;
    // A `$ref` is a recursive self-reference: the referenced component's own
    // sweep covers its interior.
    if (node.$ref) return;
    if (node.$id) {
      if (seenIds.includes(node.$id)) return;
      seenIds = [...seenIds, node.$id];
    }
    if (Array.isArray(node.anyOf)) {
      for (const branch of node.anyOf) visit(branch, path, depth + 1, seenIds);
      return;
    }
    // Type.Intersect (highcharts `options`): positions live in the branches.
    if (Array.isArray(node.allOf)) {
      for (const branch of node.allOf) visit(branch, path, depth + 1, seenIds);
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

  // Type.Intersect (highcharts `options`: a Record intersected with a shape
  // object): build every branch and merge, routing the path to the first
  // branch that can carry it.
  if (Array.isArray(schema.allOf)) {
    const merged: Json = {};
    let pathCarried = includePath.length === 0;
    for (const branch of schema.allOf) {
      let part: unknown;
      if (!pathCarried) {
        try {
          part = buildValue(branch, includePath, terminalObject);
          pathCarried = true;
        } catch {
          part = buildValue(branch, []);
        }
      } else {
        part = buildValue(branch, []);
      }
      if (part && typeof part === 'object' && !Array.isArray(part)) {
        Object.assign(merged, part);
      }
    }
    if (!pathCarried) {
      throw new Error('no intersect branch carries the path');
    }
    return merged;
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
        // First element materializes the path; pad to minItems.
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
 * Semantic rules the props schema cannot express, satisfied on the baseline:
 * `text` demands exactly one of `text`/`runs` (both optional in the schema),
 * and the conflict collector walks the WHOLE document — including component
 * stubs built inside template `objects`. Seed a `text` wherever a text node
 * carries neither, without touching nodes a materialized path already fed.
 *
 * MUTATES `built` in place (and returns it): the seeded nodes are found by
 * walking, so cloning would mean re-locating them. For the `text` component
 * itself, `built` IS the props — the wrapper below only lends it the
 * `{ name: 'text' }` shape the walk keys on; the wrapper is discarded.
 */
function satisfyTextContentRule(componentName: string, built: Json): Json {
  const props =
    componentName === 'text' ? { name: 'text', props: built } : built;
  const visit = (node: any): void => {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (!node || typeof node !== 'object') return;
    if (node.name === 'text') {
      const p = node.props;
      if (p && typeof p === 'object' && !('text' in p) && !('runs' in p)) {
        p.text = 'x';
      }
    }
    Object.values(node).forEach(visit);
  };
  visit(props);
  return built;
}

function componentDoc(name: string, props: unknown): Json {
  if (name === 'pptx') {
    return { name: 'pptx', props, children: [] };
  }
  const component: Json = { name, props };
  return {
    name: 'pptx',
    props: { title: 'Guard deck' },
    children:
      name === 'slide'
        ? [component]
        : [{ name: 'slide', children: [component] }],
  };
}

async function generationVerdict(
  doc: Json
): Promise<'accepted' | 'rejected-by-validation' | 'failed-otherwise'> {
  try {
    await generateBufferFromJson(doc as never);
    return 'accepted';
  } catch (error) {
    return error instanceof PresentationValidationError
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

  // The rejection must be localized: with no whole-document stage behind the
  // walk, a root-only generic error would mean nothing actually saw the
  // position.
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
  it.each(PPTX_STANDARD_COMPONENTS_REGISTRY.map((c) => [c.name, c] as const))(
    '%s',
    async (name, component) => {
      const positions = enumerateClosedObjects(component.propsSchema);
      expect(positions.length).toBeGreaterThan(0);

      for (const path of positions) {
        const label = `${name} props/${path.join('/') || '(root)'}`;
        let baselineProps: Json;
        try {
          baselineProps = satisfyTextContentRule(
            name,
            buildValue(component.propsSchema, path, true) as Json
          );
        } catch (error) {
          throw new Error(
            `could not build a valid instance for ${label}: ${
              error instanceof Error ? error.message : error
            }`
          );
        }

        let baseline = componentDoc(name, baselineProps);
        let injected = componentDoc(name, injectProbe(baselineProps, path));

        // A materialized prop may be renderer-gated (slide `transition` is
        // office-open-only). The guard pins schema shape, not renderer
        // capability — when the ONLY baseline complaints are renderer-profile
        // ones, pin the renderer that supports the feature and sweep on.
        const probe = validate.jsonDocument(JSON.stringify(baseline));
        if (
          !probe.valid &&
          (probe.errors ?? []).length > 0 &&
          (probe.errors ?? []).every(
            (e) => e.code === 'unsupported_renderer_feature'
          )
        ) {
          baseline = { ...baseline, renderer: 'office-open' };
          injected = { ...injected, renderer: 'office-open' };
        }

        await expectGuarded(label, baseline, injected);
      }
    },
    120_000
  );
});

// ---------------------------------------------------------------------------
// Sweep 2: a defective component at every embedding position — junk in the
// props, an unknown sibling key, and a wrong-typed known sibling key.
// ---------------------------------------------------------------------------

describe('a defective component is rejected at every embedding position', () => {
  const text = (extra?: Json): Json => ({
    name: 'text',
    props: { text: 'x', ...(extra?.props as Json) },
    ...(extra
      ? Object.fromEntries(Object.entries(extra).filter(([k]) => k !== 'props'))
      : {}),
  });

  const deck = (slides: unknown[]): Json => ({
    name: 'pptx',
    props: { title: 'Guard deck' },
    children: slides,
  });

  /** Each embedding builds the same document around a text payload. */
  const EMBEDDINGS: Record<string, (t: Json) => Json> = {
    'slide children': (t) => deck([{ name: 'slide', children: [t] }]),
    'slide placeholder value': (t) =>
      deck([
        { name: 'slide', props: { placeholders: { title: t } }, children: [] },
      ]),
    'root children (slide)': (t) =>
      deck([{ name: 'slide', children: [], ...pickSiblings(t) }]),
  };

  /** For the root-children case the payload's defect rides on the SLIDE. */
  function pickSiblings(t: Json): Json {
    return Object.fromEntries(
      Object.entries(t).filter(([key]) => key !== 'name' && key !== 'props')
    );
  }

  const CASES: [string, Json][] = [
    ['unknown props key', text({ props: { [PROBE_KEY]: 1 } })],
    ['unknown sibling key', text({ [PROBE_KEY]: 1 })],
    ['wrong-typed enabled sibling', text({ enabled: 'yes' })],
    ['wrong-typed id sibling', text({ id: 7 })],
  ];

  for (const [embedLabel, build] of Object.entries(EMBEDDINGS)) {
    // The root-children embedding carries only sibling defects — the payload
    // rides on the SLIDE via pickSiblings, so a props-key case would probe
    // nothing (a slide's own props junk is Sweep 1's job). Filtered out here
    // rather than skipped in the body, so no green test hides an unexercised
    // case.
    const cases =
      embedLabel === 'root children (slide)'
        ? CASES.filter(([caseLabel]) => caseLabel !== 'unknown props key')
        : CASES;
    it.each(cases)(
      `${embedLabel} — %s`,
      async (caseLabel, payload) => {
        await expectGuarded(
          `${embedLabel}: ${caseLabel}`,
          build(text()),
          build(payload)
        );
      },
      60_000
    );
  }

  // The embeddings above are written out by hand, so their coverage is pinned
  // to the registry: a component gaining `hasPlaceholders` (or a new
  // container) widens the embedding surface, and this assertion is what makes
  // that widening extend the sweep instead of silently escaping it.
  it('EMBEDDINGS cover every container and placeholder carrier the registry declares', () => {
    const placeholderCarriers = PPTX_STANDARD_COMPONENTS_REGISTRY.filter(
      (c) => c.hasPlaceholders
    ).map((c) => c.name);
    const containers = PPTX_STANDARD_COMPONENTS_REGISTRY.filter(
      (c) => c.hasChildren
    ).map((c) => c.name);

    expect(placeholderCarriers).toEqual(['slide']);
    expect(containers.sort()).toEqual(['pptx', 'slide']);
  });

  it('rejects sibling defects on the document root itself', async () => {
    const baseline = deck([{ name: 'slide', children: [text()] }]);
    await expectGuarded('root unknown sibling', baseline, {
      ...baseline,
      [PROBE_KEY]: 1,
    });
    await expectGuarded('root wrong-typed enabled', baseline, {
      ...baseline,
      enabled: 'yes',
    });
  }, 60_000);
});
