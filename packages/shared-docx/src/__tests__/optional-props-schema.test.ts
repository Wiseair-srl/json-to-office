/**
 * `props` must be required in the exported schema exactly when the runtime
 * rejects the component without it.
 *
 * Every component variant exported `props` as required, including the ones
 * whose props carry no required field. The runtime disagrees: it treats an
 * omitted `props` as `{}` and lets the props schema decide (deep-validator.ts).
 * Nothing in CI compared the two — the asset gate runs the runtime validator,
 * and the one step that used the exported schema only saw examples that write
 * `props` everywhere. So the playground reddened all 23 propless `section`
 * nodes in the shipped tech-report template while every gate stayed green.
 *
 * These assertions are parity checks, not restatements of the rule: each case
 * runs the same document through both validators and requires the same answer.
 */
import { describe, it, expect } from 'vitest';
import { Value } from '@sinclair/typebox/value';
import { generateUnifiedDocumentSchema } from '../schemas/generator';
import { convertToJsonSchema } from '../schemas/export';
import { validateStrict } from '../validation/unified';
import { unionBranches } from '@json-to-office/shared';
import {
  DEFAULT_DOCX_RENDERER_ID,
  docxComponentDefinitionName,
} from '../schemas/renderer';

const exported = generateUnifiedDocumentSchema({ customComponents: [] });

/** Wrap a component in the minimum valid document around it. */
function inSection(child: Record<string, unknown>) {
  return { name: 'docx', children: [{ name: 'section', children: [child] }] };
}

function variantRequired(name: string): string[] {
  const json = convertToJsonSchema(exported) as Record<string, any>;
  // Optionality is the same in either renderer view; read the default one.
  // Exported unions are restructured into if/then dispatch — iterate the
  // branch objects shape-agnostically.
  const variants = unionBranches(
    json.definitions[docxComponentDefinitionName(DEFAULT_DOCX_RENDERER_ID)]
  );
  const variant = variants.find(
    (v: any) => v?.properties?.name?.const === name
  );
  expect(variant, `no exported variant for "${name}"`).toBeDefined();
  return (variant as any).required ?? [];
}

// Props schemas with no required field: a bare `{ name }` is a valid node.
const PROPLESS_OK = [
  'section',
  'toc',
  'group',
  'image',
  'text-box',
  'divider',
] as const;
// Props schemas that demand a field: omitting `props` omits that field too.
const PROPS_REQUIRED = [
  'heading',
  'block',
  'paragraph',
  'statistic',
  'table',
  'list',
  'columns',
  'highcharts',
  'visual',
] as const;

describe('props optionality', () => {
  it.each(PROPLESS_OK)('exports `props` as optional for %s', (name) => {
    expect(variantRequired(name)).not.toContain('props');
  });

  it.each(PROPS_REQUIRED)('keeps `props` required for %s', (name) => {
    expect(variantRequired(name)).toContain('props');
  });

  it.each(PROPLESS_OK)('both validators accept a propless %s', (name) => {
    const doc =
      name === 'section'
        ? { name: 'docx', children: [{ name: 'section' }] }
        : inSection({ name });
    expect(validateStrict.document(doc).valid).toBe(true);
    expect(Value.Check(exported, doc)).toBe(true);
  });

  it.each(PROPS_REQUIRED)('both validators reject a propless %s', (name) => {
    const doc = inSection({ name });
    expect(validateStrict.document(doc).valid).toBe(false);
    expect(Value.Check(exported, doc)).toBe(false);
  });

  it.each([...PROPLESS_OK, ...PROPS_REQUIRED])(
    'both validators reject an explicit null props on %s',
    (name) => {
      // Omissible is not nullable. `props: null` is a key the author wrote and
      // the exported schema types it `object` everywhere, so a walk that reads
      // a written `null` as an omission accepts documents that schema rejects.
      // The root has always been checked with `'props' in data`; the nested
      // walk now is too.
      const doc = inSection({ name, props: null });
      expect(Value.Check(exported, doc)).toBe(false);
      expect(validateStrict.document(doc).valid).toBe(false);
    }
  );

  it('accepts the shipped tech-report shape: sections with no props', () => {
    const doc = {
      name: 'docx',
      props: { theme: 'minimal' },
      children: [
        {
          name: 'section',
          children: [{ name: 'paragraph', props: { text: 'A' } }],
        },
        {
          name: 'section',
          children: [{ name: 'paragraph', props: { text: 'B' } }],
        },
      ],
    };
    expect(validateStrict.document(doc).valid).toBe(true);
    expect(Value.Check(exported, doc)).toBe(true);
  });

  it('still requires `children` on the root', () => {
    // Root `children` was enforced only by the deep validator, which runs on
    // the fallback path taken when the TypeBox check has already failed. It
    // fired only because `props` was required; relaxing `props` would have
    // retired the rule silently, so the schema now carries it.
    expect(variantRequired('docx')).toContain('children');
    expect(validateStrict.document({ name: 'docx' }).valid).toBe(false);
    expect(Value.Check(exported, { name: 'docx' })).toBe(false);
  });
});
