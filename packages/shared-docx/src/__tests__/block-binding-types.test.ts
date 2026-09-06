import { describe, expect, it } from 'vitest';
import { Type } from '@sinclair/typebox';
import { getLanguageService, TextDocument } from 'vscode-json-languageservice';
import { convertToJsonSchema, generateUnifiedDocumentSchema } from '../index';

const schema = convertToJsonSchema(
  generateUnifiedDocumentSchema({
    customComponents: [
      {
        name: 'typed-example',
        propsSchema: Type.Object({
          text: Type.String(),
          amount: Type.Number(),
          flag: Type.Boolean(),
          settings: Type.Object({
            count: Type.Integer(),
            label: Type.Optional(Type.String()),
          }),
          entries: Type.Array(
            Type.Object({
              label: Type.String(),
              count: Type.Optional(Type.Number()),
            })
          ),
          choice: Type.Union([Type.Number(), Type.String()]),
          enumOnly: Type.Unsafe({ enum: ['small', 'large'] }),
          intersection: Type.Unsafe({
            allOf: [{ type: ['number', 'string'] }, { type: 'number' }],
          }),
          recursive: Type.Recursive(
            (self) =>
              Type.Object({ title: Type.String(), next: Type.Optional(self) }),
            { $id: 'BindingRecursiveExample' }
          ),
        }),
      },
    ],
  })
);

async function inspect(body: string) {
  const text = `{"name":"docx","props":{"blocks":{"example":{"slots":{},"body":[${body}]}}},"children":[]}`;
  const offset = text.indexOf('|');
  const service = getLanguageService({});
  service.configure({
    schemas: [{ uri: 'test://typed-blocks', fileMatch: ['*.json'], schema }],
  });
  const document = TextDocument.create(
    'test://document.json',
    'json',
    1,
    text.replace('|', '')
  );
  const parsed = service.parseJSONDocument(document);
  const completions =
    offset < 0
      ? []
      : (
          await service.doComplete(
            document,
            document.positionAt(offset),
            parsed
          )
        )?.items ?? [];
  return {
    labels: completions.map((item) => item.label.replace(/"/g, '')),
    diagnostics: await service.doValidation(document, parsed),
  };
}
const atProp = (key: string, value: string) =>
  `{"name":"typed-example","props":{"${key}":${value}}}`;
const refs = ['$slot', '$item', '$theme', '$context', '$if'];

// Completion is tested on partial JSON, not just valid documents: that is where
// overlapping union branches previously offered invalid directives/options.
describe('type-directed block bindings', () => {
  it('offers only object-compatible starters in the reported columns props position', async () => {
    const { labels } = await inspect('{"name":"columns","props":{"|"}}');
    expect(labels.sort()).toEqual([...refs, 'columns', 'gap'].sort());
  });
  it.each([
    ['text', ['$join']],
    ['amount', ['$count', '$measure']],
    ['flag', []],
    ['settings', []],
    ['entries', ['$each']],
    ['choice', ['$count', '$measure', '$join']],
    ['enumOnly', ['$join']],
    ['intersection', ['$count', '$measure']],
    ['recursive', []],
  ])('derives %s bindings from its schema', async (key, operations) => {
    const { labels } = await inspect(atProp(key, '{"|"}'));
    expect(labels.filter((label) => label.startsWith('$')).sort()).toEqual(
      [...refs, ...operations].sort()
    );
    expect(labels).not.toEqual(
      expect.arrayContaining(['default', 'then', 'else', 'template'])
    );
  });
  it('keeps all numeric-or-array alternatives for columns', async () => {
    const { labels } = await inspect(
      '{"name":"columns","props":{"columns":{"|"}}}'
    );
    expect(labels.sort()).toEqual(
      [...refs, '$count', '$measure', '$each'].sort()
    );
  });
  it.each(['$', '$s', '$sl', '$i'])(
    'keeps directive starters while typing %s',
    async (prefix) => {
      const { labels } = await inspect(
        `{"name":"columns","props":{"${prefix}|"}}`
      );
      expect(labels.filter((label) => label.startsWith('$')).sort()).toEqual(
        [...refs].sort()
      );
    }
  );
  it('does not offer directives while typing a normal property or mixing with one', async () => {
    for (const props of ['{"co|"}', '{"columns":2,"$s|"}']) {
      expect(
        (await inspect(`{"name":"columns","props":${props}}`)).labels.some(
          (label) => label.startsWith('$')
        )
      ).toBe(false);
    }
  });
  it('stops offering whole-object bindings after a normal property', async () => {
    expect(
      (await inspect('{"name":"columns","props":{"columns":2,"|"}}')).labels
    ).toEqual(['gap']);
  });
  it.each([
    ['$slot', '"/settings"', ['default']],
    ['$if', '"/enabled"', ['then', 'else']],
  ])(
    'offers only %s options after it is selected',
    async (key, value, expected) => {
      const { labels } = await inspect(
        `{"name":"columns","props":{"${key}":${value},"|"}}`
      );
      expect(labels.sort()).toEqual(expected.sort());
    }
  );
  it('narrows scalar directive options', async () => {
    expect(
      (await inspect(atProp('text', '{"$join":[],"|"}'))).labels.sort()
    ).toEqual(['keepEmpty', 'separator']);
    expect(
      (
        await inspect(atProp('amount', '{"$measure":"width","|"}'))
      ).labels.sort()
    ).toEqual(['fraction', 'unit']);
    expect(
      (await inspect(atProp('entries', '{"$each":"/items","|"}'))).labels
    ).toEqual(['template']);
  });
  it.each(['then', 'else'])(
    'retains object properties and binding types inside $if %s',
    async (branch) => {
      const { labels } = await inspect(
        `{"name":"columns","props":{"$if":"/enabled","${branch}":{"|"}}}`
      );
      expect(labels.sort()).toEqual([...refs, 'columns', 'gap'].sort());
    }
  );
  it('retains object types in a reference fallback', async () => {
    const { labels } = await inspect(
      '{"name":"columns","props":{"$slot":"/settings","default":{"|"}}}'
    );
    expect(labels.sort()).toEqual([...refs, 'columns', 'gap'].sort());
  });
  it('uses the array item schema inside $each templates', async () => {
    const { labels } = await inspect(
      atProp('entries', '{"$each":"/items","template":{"|"}}')
    );
    expect(labels.sort()).toEqual([...refs, 'label', 'count'].sort());
  });
  it('supports repetition at component-array positions without offering scalar results', async () => {
    const { labels } = await inspect('{"|"}');
    expect(labels.sort()).toEqual([...refs, '$each', 'name'].sort());
  });
  it('preserves recursive plugin schema completion', async () => {
    const { labels } = await inspect(
      atProp(
        'recursive',
        '{"title":"root","next":{"title":"child","next":{"|"}}}'
      )
    );
    expect(labels.sort()).toEqual([...refs, 'title', 'next'].sort());
  });
  it.each([
    '{"name":"columns","props":{"columns":{"$count":"/items"},"gap":12}}',
    '{"name":"columns","props":{"$slot":"/settings","default":{"columns":2}}}',
    '{"name":"columns","props":{"$if":"/enabled","then":{"columns":2},"else":{"columns":1}}}',
    '{"$each":"/items","template":{"name":"paragraph","props":{"text":{"$item":"/title"}}}}',
    '{"$if":"/enabled","then":[{"name":"paragraph","props":{"text":"A"}},{"name":"paragraph","props":{"text":"B"}}]}',
    '{"name":"columns","props":{"columns":{"$each":"/items","template":{"width":"auto"}}}}',
    '{"name":"columns","props":{"columns":[{"$each":"/items","template":{"width":"auto"}}]}}',
  ])('accepts valid typed and sequence bindings: %s', async (body) => {
    expect((await inspect(body)).diagnostics).toEqual([]);
  });
  it.each([
    '{"name":"columns","props":{"$count":"/items"}}',
    '{"name":"columns","props":{"$measure":"width"}}',
    '{"name":"columns","props":{"$join":["a","b"]}}',
    '{"name":"columns","props":{"$each":"/items","template":{"columns":2}}}',
    '{"name":"columns","props":{"$slot":"/settings","gap":12}}',
    '{"name":"columns","props":{"$slot":"/settings","$if":"/enabled","then":{"columns":2}}}',
    '{"name":"columns","props":{"$slot":"/settings","default":42}}',
    '{"name":"columns","props":{"$if":"/enabled","then":"wrong"}}',
    '{"name":"columns","props":{"columns":{"$each":"/items","template":"wrong"}}}',
    '{"name":"paragraph","props":{"text":{"$count":"/items"}}}',
  ])(
    'rejects incompatible output types or mixed syntaxes: %s',
    async (body) => {
      expect((await inspect(body)).diagnostics.length).toBeGreaterThan(0);
    }
  );
});
