import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Value } from '@sinclair/typebox/value';
import { validateDocument } from '../validation/unified/document-validator';
import { generateUnifiedDocumentSchema } from '../schemas/generator';

const example = () =>
  JSON.parse(
    readFileSync(
      new URL(
        '../../../jto/src/client/public/templates/client-report-blocks.docx.json',
        import.meta.url
      ),
      'utf8'
    )
  );
describe('document-local block schema', () => {
  it('exports a schema that accepts the complete playground document', () => {
    const document = example();
    expect(
      Value.Check(
        generateUnifiedDocumentSchema({ customComponents: [] }),
        document
      )
    ).toBe(true);
    expect(validateDocument(document).valid).toBe(true);
  });
  it('rejects the removed named-component surface', () => {
    const document = example();
    document.children[0].children[0] = {
      name: 'cover',
      props: { title: 'Old shape' },
    };
    expect(validateDocument(document).errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'unknown_component' }),
      ])
    );
  });
  it('reports malformed definitions and bindings at their authored definition pointers', () => {
    const document = example();
    document.props.blocks.cover.body[0] = { $code: 'arbitrary()' };
    expect(validateDocument(document).errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'block_invalid_binding',
          path: '/props/blocks/cover/body/0',
        }),
      ])
    );
  });
  it('rejects unknown invocation properties instead of treating them as overrides', () => {
    const document = example();
    document.children[0].children[0].props.x = 20;
    expect(validateDocument(document).valid).toBe(false);
  });
  it('rejects placement passed through component slots', () => {
    const document = example();
    document.children[0].children[0].props.slots.logo = {
      name: 'image',
      props: { width: 40, alignment: 'right' },
    };
    expect(validateDocument(document).errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'block_slot_placement',
          path: '/children/0/children/0/props/slots/logo/props/alignment',
        }),
      ])
    );
  });
});
