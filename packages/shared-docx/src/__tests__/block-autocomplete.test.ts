import { describe, expect, it } from 'vitest';
import { Type } from '@sinclair/typebox';
import { getLanguageService, TextDocument } from 'vscode-json-languageservice';
import { convertToJsonSchema } from '../schemas/export';
import { generateUnifiedDocumentSchema } from '../schemas/generator';

const schema = convertToJsonSchema(
  generateUnifiedDocumentSchema({
    customComponents: [
      {
        name: 'weather',
        propsSchema: Type.Object(
          { city: Type.String() },
          { additionalProperties: false }
        ),
        versionedProps: [
          {
            version: '1.0.0',
            propsSchema: Type.Object(
              { city: Type.String() },
              { additionalProperties: false }
            ),
          },
          {
            version: '2.0.0',
            propsSchema: Type.Object(
              { city: Type.String(), units: Type.Optional(Type.String()) },
              { additionalProperties: false }
            ),
          },
        ],
      },
    ],
  })
);
const documentWithBody = (body: string, renderer = '') =>
  `{"name":"docx",${renderer}"props":{"blocks":{"example":{"slots":{},"body":[${body}]}}},"children":[]}`;
async function inspect(text: string) {
  const offset = text.indexOf('|');
  const ls = getLanguageService({});
  ls.configure({
    schemas: [{ uri: 'test://blocks', fileMatch: ['*.json'], schema }],
  });
  const doc = TextDocument.create(
    'test://doc.json',
    'json',
    1,
    text.replace('|', '')
  );
  const parsed = ls.parseJSONDocument(doc);
  return {
    labels:
      offset < 0
        ? []
        : (await ls.doComplete(doc, doc.positionAt(offset), parsed))?.items.map(
            (item) => item.label.replace(/"/g, '')
          ) ?? [],
    diagnostics: await ls.doValidation(doc, parsed),
  };
}

describe('block authoring through the real JSON language service', () => {
  it('completes body components and registered plugins', async () => {
    const { labels } = await inspect(documentWithBody('{"name":"|"}'));
    expect(labels).toEqual(
      expect.arrayContaining([
        'paragraph',
        'heading',
        'block',
        'group',
        'weather',
      ])
    );
    expect(labels).not.toContain('docx');
    expect(labels).not.toContain('section');
  });
  it.each(['paragraph', 'weather'])('completes %s properties', async (name) => {
    const { labels } = await inspect(
      documentWithBody(`{"name":"${name}","props":{|}}`)
    );
    expect(labels).toContain(name === 'paragraph' ? 'text' : 'city');
  });
  it('completes version-specific plugin props and accepts their bindings', async () => {
    expect(
      (
        await inspect(
          documentWithBody('{"name":"weather","version":"2.0.0","props":{|}}')
        )
      ).labels
    ).toContain('units');
    expect(
      (
        await inspect(
          documentWithBody(
            '{"name":"weather","version":"2.0.0","props":{"city":{"$slot":"/city"}}}'
          )
        )
      ).diagnostics
    ).toEqual([]);
  });
  it('completes binding directives at value positions', async () => {
    const { labels } = await inspect(
      documentWithBody('{"name":"paragraph","props":{"text":{|}}}')
    );
    expect(labels).toEqual(expect.arrayContaining(['$slot', '$theme', '$if']));
  });
  it.each([
    '{"$if":"/subtitle","then":[{"name":"|"}]}',
    '{"$each":"/items","template":{"name":"|"}}',
    '{"name":"group","children":[{"name":"|"}]}',
  ])('completes components through nested composition: %s', async (body) => {
    expect((await inspect(documentWithBody(body))).labels).toContain(
      'paragraph'
    );
  });
  it.each(['header', 'footer'])(
    'completes components in section %s definitions',
    async (part) => {
      const text = `{"name":"docx","props":{"blocks":{"example":{"slots":{},"body":[],"section":{"${part}":[{"name":"|"}]}}}},"children":[]}`;
      expect((await inspect(text)).labels).toContain('paragraph');
    }
  );
  it('accepts bindings in props and nested font values without a format field', async () => {
    const body =
      '{"name":"paragraph","props":{"text":{"$slot":"/title"},"font":{"size":{"$theme":"/styles/body/size","default":12}}}}';
    expect((await inspect(documentWithBody(body))).diagnostics).toEqual([]);
  });
  it('does not allow block bindings in ordinary document props', async () => {
    expect(
      (
        await inspect(
          '{"name":"docx","children":[{"name":"section","children":[{"name":"paragraph","props":{"text":{"$slot":"/title"}}}]}]}'
        )
      ).diagnostics.length
    ).toBeGreaterThan(0);
  });
  it('preserves literal prop validation in definitions', async () => {
    expect(
      (
        await inspect(
          documentWithBody('{"name":"paragraph","props":{"text":42}}')
        )
      ).diagnostics.length
    ).toBeGreaterThan(0);
  });
  it('uses the selected renderer’s component surface', async () => {
    const body = '{"name":"chart","props":{"type":"bar","series":[]}}';
    const normal = await inspect(documentWithBody(body));
    expect(
      normal.diagnostics.some((item) => item.message.includes('chart'))
    ).toBe(true);
    expect(
      (
        await inspect(
          documentWithBody('{"name":"|"}', '"renderer":"office-open",')
        )
      ).labels
    ).toContain('chart');
  });
});
