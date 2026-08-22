import { Value } from '@sinclair/typebox/value';
import { Type } from '@sinclair/typebox';
import { describe, expect, it } from 'vitest';
import { generateUnifiedDocumentSchema } from '../schemas/generator';
import { validateDocument } from '../validation/unified';

function document(renderer?: 'docxjs' | 'office-open') {
  return {
    name: 'docx',
    ...(renderer ? { renderer } : {}),
    props: {},
    children: [
      {
        name: 'paragraph',
        props: {
          text: 'Commented',
          comment: {
            text: 'Parent',
            replies: [{ text: 'Reply' }],
          },
        },
      },
    ],
  };
}

describe('renderer-discriminated DOCX schema', () => {
  const schema = generateUnifiedDocumentSchema();

  it('uses docxjs when renderer is omitted', () => {
    expect(Value.Check(schema, document())).toBe(true);
  });

  it('removes threaded comments from office-open', () => {
    expect(Value.Check(schema, document('office-open'))).toBe(false);
    const flat = document('office-open');
    delete (flat.children[0].props.comment as any).replies;
    expect(Value.Check(schema, flat)).toBe(true);
  });

  it('preserves plugins in both renderer branches', () => {
    const pluginSchema = generateUnifiedDocumentSchema({
      customComponents: [
        {
          name: 'callout',
          propsSchema: Type.Object({ text: Type.String() }),
        },
      ],
    });
    for (const renderer of ['docxjs', 'office-open'] as const) {
      const value = document(renderer);
      value.children = [
        { name: 'callout', props: { text: renderer } },
      ] as never;
      expect(Value.Check(pluginSchema, value)).toBe(true);
    }
  });
});

describe('renderer-aware DOCX validation', () => {
  it('reports office-open threaded comments', () => {
    expect(validateDocument(document('office-open')).errors).toContainEqual(
      expect.objectContaining({
        path: '/children/0/props/comment/replies',
        code: 'unsupported_renderer_feature',
      })
    );
  });
});
