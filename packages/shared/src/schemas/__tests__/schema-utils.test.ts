import { describe, expect, it } from 'vitest';
import { fixSchemaReferences } from '../schema-utils';

/**
 * A `$ref` to a definition that was never hoisted is not a cosmetic flaw: Ajv
 * refuses to compile the whole schema over one, so the schema fails on itself
 * before it looks at any document. These pin the two ways this pass used to
 * write one — substituting the root definition name for a reference that
 * resolved to nothing, and typing an untyped array item against a definition
 * the schema does not carry.
 */
describe('fixSchemaReferences never invents a definition', () => {
  it('drops a bare reference whose target was never hoisted', () => {
    const schema: Record<string, any> = {
      definitions: { Other: { type: 'string' } },
      properties: { a: { $ref: 'T7' } },
    };

    fixSchemaReferences(schema);

    expect(schema.properties.a).not.toHaveProperty('$ref');
  });

  it('leaves an untyped array item untyped rather than pointing it nowhere', () => {
    const schema: Record<string, any> = {
      definitions: { Other: { type: 'string' } },
      properties: { list: { type: 'array', items: {} } },
    };

    fixSchemaReferences(schema);

    expect(schema.properties.list.items).toEqual({});
  });

  it('still resolves a reference that does have a definition', () => {
    const schema: Record<string, any> = {
      definitions: { ComponentDefinition: { type: 'object' }, T0: {} },
      properties: {
        a: { $ref: 'ComponentDefinition' },
        b: { type: 'array', items: { $ref: 'T0' } },
        c: { type: 'array', items: {} },
      },
    };

    fixSchemaReferences(schema);

    expect(schema.properties.a.$ref).toBe('#/definitions/ComponentDefinition');
    expect(schema.properties.b.items.$ref).toBe('#/definitions/T0');
    expect(schema.properties.c.items.$ref).toBe(
      '#/definitions/ComponentDefinition'
    );
  });

  it('resolves each renderer definition to itself, not to whichever is first', () => {
    const schema: Record<string, any> = {
      definitions: {
        ComponentDefinition_docxjs: { type: 'object' },
        'ComponentDefinition_office-open': { type: 'object' },
      },
      properties: {
        a: { $ref: 'ComponentDefinition_docxjs' },
        b: { $ref: 'ComponentDefinition_office-open' },
      },
    };

    fixSchemaReferences(schema);

    expect(schema.properties.a.$ref).toBe(
      '#/definitions/ComponentDefinition_docxjs'
    );
    expect(schema.properties.b.$ref).toBe(
      '#/definitions/ComponentDefinition_office-open'
    );
  });
});
