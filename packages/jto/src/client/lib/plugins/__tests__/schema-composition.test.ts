import { describe, expect, it } from 'vitest';
import Ajv from 'ajv';
import { Type } from '@sinclair/typebox';
import {
  generateUnifiedDocumentSchema as generateDocxSchema,
  convertToJsonSchema,
} from '@json-to-office/shared-docx';
import { generateUnifiedDocumentSchema as generatePptxSchema } from '@json-to-office/shared-pptx';
import { unionBranches } from '@json-to-office/shared';

/**
 * A browser plugin's props schema reaches the server as plain JSON — the
 * TypeBox object it was built from does not survive `postMessage`. The
 * unified generators must compose such a schema into a document schema that
 * a JSON Schema validator accepts and that enforces the plugin's props.
 */
const propsSchema = JSON.parse(
  JSON.stringify(
    Type.Object(
      {
        label: Type.String(),
        value: Type.Number({ minimum: 0 }),
      },
      { additionalProperties: false }
    )
  )
);

function pluginBranchCount(schema: unknown, name: string): number {
  const seen = new Set<object>();
  let count = 0;
  const visit = (node: unknown): void => {
    if (!node || typeof node !== 'object' || seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    const record = node as Record<string, unknown>;
    const nameProp = (record.properties as Record<string, unknown> | undefined)
      ?.name as { const?: unknown } | undefined;
    if (nameProp?.const === name) count++;
    Object.values(record).forEach(visit);
  };
  visit(schema);
  return count;
}

describe('document schema composition with JSON props schemas', () => {
  it.each([
    [
      'docx',
      () =>
        convertToJsonSchema(
          generateDocxSchema({
            customComponents: [
              {
                name: 'kpi',
                propsSchema,
                versionedProps: [
                  { version: '1.0.0', propsSchema },
                  { version: '2.0.0', propsSchema, hasChildren: true },
                ],
              },
            ],
          }),
          { $id: 'test-docx' }
        ),
      { name: 'docx', props: {}, children: [] },
    ],
    [
      'pptx',
      () =>
        convertToJsonSchema(
          generatePptxSchema({
            customComponents: [
              {
                name: 'kpi',
                versions: [
                  { version: '1.0.0', propsSchema },
                  { version: '2.0.0', propsSchema, hasChildren: true },
                ],
              },
            ],
          }),
          { $id: 'test-pptx' }
        ),
      { name: 'pptx', props: { title: 'x' }, children: [] },
    ],
  ] as const)(
    '%s: the plugin becomes a validated branch',
    (format, build, root) => {
      const schema = build();
      expect(pluginBranchCount(schema, 'kpi')).toBeGreaterThan(0);

      // Compiling the whole document schema is the slow part — seconds on a
      // cold Windows runner — so the budget is declared here, where the cost
      // is. `logger: false` silences the format warnings the schema's
      // date-time and uri fields raise without ajv-formats.
      const ajv = new Ajv({ strict: false, allErrors: true, logger: false });
      const validate = ajv.compile(schema);
      const withPlugin = (node: unknown) =>
        format === 'docx'
          ? {
              ...root,
              children: [{ name: 'section', props: {}, children: [node] }],
            }
          : {
              ...root,
              children: [{ name: 'slide', props: {}, children: [node] }],
            };

      expect(
        validate(withPlugin({ name: 'kpi', props: { label: 'ARR', value: 1 } }))
      ).toBe(true);
      expect(
        validate(
          withPlugin({
            name: 'kpi',
            version: '2.0.0',
            props: { label: 'ARR', value: 1 },
          })
        )
      ).toBe(true);
      expect(
        validate(withPlugin({ name: 'kpi', props: { label: 'ARR' } }))
      ).toBe(false);
      expect(
        validate(
          withPlugin({ name: 'kpi', props: { label: 'ARR', value: -1 } })
        )
      ).toBe(false);
      expect(
        validate(withPlugin({ name: 'kpi', version: '9.9.9', props: {} }))
      ).toBe(false);
    },
    30_000
  );

  it('exposes the branches the playground injects theme names into', () => {
    const schema = convertToJsonSchema(
      generatePptxSchema({ customComponents: [] }),
      { $id: 'x' }
    );
    expect(unionBranches(schema).length).toBeGreaterThan(0);
  });
});
