/**
 * `props` must be required in the exported schema exactly when the runtime
 * rejects the component without it.
 *
 * Both sides were wrong here, in opposite directions. The exported schema
 * marked `props` required on every component, including `slide`, whose props
 * are all optional — so a slide that renders was flagged by the editor, the
 * MCP describe tool and every agent reading them. The deep validator, meant to
 * "let the schema decide", accepted a bare `{ "name": "text" }`: `text` and
 * `runs` are both optional fields (the content rule that binds them lives in
 * text-content-conflicts.ts), so an empty props object passes TypeBox and a
 * missing one passed with it.
 *
 * The registry now answers "must this carry props?" once, for the generator
 * and the validator alike, which is what these assertions check: each case
 * runs the same document through both and requires the same verdict. A
 * mismatch here is a document an agent is told to write one way and told off
 * for writing the other.
 */
import { describe, it, expect } from 'vitest';
import { Value } from '@sinclair/typebox/value';
import { convertToJsonSchema, unionBranches } from '@json-to-office/shared';
import { generateUnifiedDocumentSchema } from '../schemas/generator';
import {
  PPTX_STANDARD_COMPONENTS_REGISTRY,
  pptxComponentRequiresProps,
} from '../schemas/component-registry';
import { validatePresentationDocument } from '../validation/unified';

const exported = generateUnifiedDocumentSchema({ customComponents: [] });
const json = convertToJsonSchema(exported, {
  $id: 'presentation.schema.json',
}) as Record<string, any>;

/** Props schemas with no required field and no rule outside it: bare `{ name }`. */
const PROPLESS_OK = ['slide'] as const;
/**
 * Everything else. `shape`, `table`, `highcharts` and `chart` demand a field in
 * the schema itself; `pptx`, `text` and `image` are the registry's declared
 * exceptions (root metadata, `text`/`runs`, one image source).
 */
const PROPS_REQUIRED = [
  'pptx',
  'text',
  'image',
  'shape',
  'table',
  'highcharts',
  'chart',
] as const;

/**
 * Does the published schema require `props` on this component?
 *
 * Read from every renderer profile that offers the component, not one chosen
 * profile: optionality is not renderer-specific, and a profile that disagreed
 * would publish two answers to the same question.
 */
function publishedRequiresProps(name: string): boolean {
  const verdicts = new Set<boolean>();
  for (const definition of Object.values(json.definitions ?? {})) {
    for (const branch of unionBranches(definition) as any[]) {
      if (branch?.properties?.name?.const !== name) continue;
      verdicts.add((branch.required ?? []).includes('props'));
    }
  }
  expect(verdicts.size, `no exported variant for "${name}"`).toBe(1);
  return [...verdicts][0];
}

/** The smallest document placing `name` where it is allowed, carrying no props. */
function documentWithout(name: string): { document: unknown; path: string } {
  if (name === 'pptx')
    return { document: { name, children: [] }, path: '/props' };
  if (name === 'slide') {
    return {
      document: { name: 'pptx', props: {}, children: [{ name }] },
      path: '/children/0/props',
    };
  }
  return {
    document: {
      name: 'pptx',
      props: {},
      children: [{ name: 'slide', children: [{ name }] }],
    },
    path: '/children/0/children/0/props',
  };
}

/** The same document, but writing the key explicitly with `value`. */
function documentWithProps(
  name: string,
  value: unknown
): { document: unknown; path: string } {
  const { document, path } = documentWithout(name);
  const at = (node: any): any =>
    node.name === name
      ? Object.assign(node, { props: value })
      : at(node.children[0]);
  at(document);
  return { document, path };
}

describe('props optionality', () => {
  it.each(PROPLESS_OK)('exports `props` as optional for %s', (name) => {
    expect(publishedRequiresProps(name)).toBe(false);
  });

  it.each(PROPS_REQUIRED)('keeps `props` required for %s', (name) => {
    expect(publishedRequiresProps(name)).toBe(true);
  });

  it.each(PROPLESS_OK)('both validators accept a propless %s', (name) => {
    const { document } = documentWithout(name);
    expect(validatePresentationDocument(document).errors).toEqual([]);
    expect(Value.Check(exported, document)).toBe(true);
  });

  it.each(PROPS_REQUIRED)('both validators reject a propless %s', (name) => {
    const { document } = documentWithout(name);
    expect(validatePresentationDocument(document).valid).toBe(false);
    expect(Value.Check(exported, document)).toBe(false);
  });

  it.each([...PROPLESS_OK, ...PROPS_REQUIRED])(
    'both validators reject an explicit null props on %s',
    (name) => {
      // Omissible is not the same as nullable. `props: null` is a key the
      // author wrote, and the published schema types it `object` on every
      // component — so reading a written `null` as "left it out" is how the
      // walk would start accepting a document that schema rejects.
      const { document } = documentWithProps(name, null);
      expect(Value.Check(exported, document)).toBe(false);
      expect(validatePresentationDocument(document).valid).toBe(false);
    }
  );

  it('locates a null props at the node that carries it', () => {
    // A type error at the key, not the missing-key diagnostic: the repair is
    // to replace the value, and telling an agent to add a key it already
    // wrote sends it round the loop again.
    const { document, path } = documentWithProps('text', null);
    const errors = validatePresentationDocument(document).errors;
    expect(errors.map((error) => error.path)).toEqual([path]);
    expect(errors[0].code).not.toBe('required_property');
  });

  it('reports the missing props at a pointer, in the shared vocabulary', () => {
    // Not a TypeBox ordinal and not a path into a node that does not exist:
    // `/children/0/children/0/props` is the JSON Patch target a caller adds.
    const { document, path } = documentWithout('text');
    expect(validatePresentationDocument(document).errors).toEqual([
      {
        path,
        message: 'Component "text" is missing required field "props"',
        code: 'required_property',
        suggestion: 'Add a "props" object holding the content "text" renders.',
      },
    ]);
  });

  it('names the fields a props-demanding component needs', () => {
    const { document } = documentWithout('table');
    const [error] = validatePresentationDocument(document).errors;
    expect(error.suggestion).toBe('Add "props" carrying "rows".');
  });

  it('agrees with the schema on every component, not just the listed ones', () => {
    // The guard that keeps holding when a component is added: whatever the
    // registry decides, the generated schema and the deep walk must decide it
    // together.
    const disagreed = PPTX_STANDARD_COMPONENTS_REGISTRY.filter((component) => {
      const { document } = documentWithout(component.name);
      const runtimeRejects = !validatePresentationDocument(document).valid;
      return publishedRequiresProps(component.name) !== runtimeRejects;
    }).map((component) => component.name);
    expect(disagreed, `schema and runtime disagree on: ${disagreed}`).toEqual(
      []
    );
  });

  it('only calls props omissible when an empty object would pass', () => {
    // The other half of the same promise: a component the registry lets an
    // author skip must survive the `{}` the walk checks in its place.
    for (const component of PPTX_STANDARD_COMPONENTS_REGISTRY) {
      if (pptxComponentRequiresProps(component)) continue;
      expect(
        Value.Check(component.propsSchema, {}),
        `"${component.name}" allows an omitted props its schema then rejects`
      ).toBe(true);
    }
  });

  it('still accepts the props both components legitimately carry', () => {
    const document = {
      name: 'pptx',
      props: { title: 'Deck' },
      children: [
        {
          name: 'slide',
          props: { notes: 'Speaker notes' },
          children: [{ name: 'text', props: { text: 'Hello' } }],
        },
        {
          name: 'slide',
          children: [{ name: 'text', props: { runs: [{ text: 'Hi' }] } }],
        },
      ],
    };
    expect(validatePresentationDocument(document).errors).toEqual([]);
    expect(Value.Check(exported, document)).toBe(true);
  });
});
