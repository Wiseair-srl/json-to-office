/**
 * PPTX block bodies through the real JSON language service (the library
 * Monaco embeds). The exported schema derives block-body authoring from the
 * selected renderer's component surface and the registered plugins, exactly
 * as the DOCX export does: component names and props complete inside a
 * definition, binding directives are offered where their result type fits,
 * and ordinary slide props keep their literal schemas.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Type } from '@sinclair/typebox';
import { getLanguageService, TextDocument } from 'vscode-json-languageservice';
import {
  convertToJsonSchema,
  generateUnifiedDocumentSchema,
  pptxComponentDefinitionName,
} from '../index';

const city = Type.String({ description: 'City to look up.' });
const schema = convertToJsonSchema(
  generateUnifiedDocumentSchema({
    customComponents: [
      {
        name: 'weather',
        versions: [
          {
            version: '1.0.0',
            description: 'Weather forecast for a city.',
            propsSchema: Type.Object({ city }, { additionalProperties: false }),
          },
          {
            version: '2.0.0',
            description: 'Weather forecast for a city.',
            propsSchema: Type.Object(
              { city, units: Type.Optional(Type.String()) },
              { additionalProperties: false }
            ),
          },
        ],
      },
    ],
  })
);
const documentWithBody = (body: string, renderer = '') =>
  `{"name":"pptx",${renderer}"props":{"blocks":{"example":{"slots":{},"body":[${body}]}}},"children":[]}`;
async function inspect(text: string) {
  const offset = text.indexOf('|');
  const ls = getLanguageService({});
  ls.configure({
    schemas: [{ uri: 'test://pptx-blocks', fileMatch: ['*.json'], schema }],
  });
  const doc = TextDocument.create(
    'test://deck.json',
    'json',
    1,
    text.replace('|', '')
  );
  const parsed = ls.parseJSONDocument(doc);
  const completions =
    offset < 0
      ? []
      : (await ls.doComplete(doc, doc.positionAt(offset), parsed))?.items ?? [];
  return {
    labels: completions.map((item) => item.label.replace(/"/g, '')),
    descriptions: Object.fromEntries(
      completions.map((item) => [
        item.label.replace(/"/g, ''),
        typeof item.documentation === 'string'
          ? item.documentation
          : item.documentation?.value ?? '',
      ])
    ),
    diagnostics: await ls.doValidation(doc, parsed),
  };
}
const shippedDeck = (name: string) =>
  readFileSync(
    new URL(
      `../../../jto/src/client/public/templates/${name}.pptx.json`,
      import.meta.url
    ),
    'utf8'
  );

describe('PPTX block authoring through the real JSON language service', () => {
  it('names each renderer’s component definition stably', () => {
    const names = Object.keys(schema.definitions as Record<string, unknown>);
    expect(names).toContain(pptxComponentDefinitionName('pptxgenjs'));
    expect(names).toContain(pptxComponentDefinitionName('office-open'));
    expect(names).toContain('BlockSlot');
    expect(names.some((name) => /^T\d+$/.test(name))).toBe(false);
  });
  it('offers both renderers at the root and dispatches diagnostics on the one named', async () => {
    expect(
      (await inspect('{"name":"pptx","renderer":"|","props":{}}')).labels
    ).toEqual(expect.arrayContaining(['pptxgenjs', 'office-open']));
    const bogus = await inspect(
      '{"name":"pptx","renderer":"bogus","props":{},"children":[]}'
    );
    expect(bogus.diagnostics.map((item) => item.message).sort()).toEqual([
      'Value is not accepted. Valid values: "pptxgenjs", "office-open".',
      'Value must be "pptxgenjs".',
    ]);
  });
  it('completes an unfinished body property even before slots are declared', async () => {
    const { labels } = await inspect(
      '{"name":"pptx","props":{"blocks":{"prova":{"description":"Blocco di prova","body":[{"|"}]}}},"children":[]}'
    );
    expect(labels).toEqual(expect.arrayContaining(['name', '$slot', '$if']));
  });
  it('describes every suggestion in an empty block body, in slide terms', async () => {
    const { labels, descriptions } = await inspect(documentWithBody('{"|"}'));
    for (const label of labels) expect(descriptions[label], label).not.toBe('');
    expect(descriptions.$slot).toContain('input slot');
    expect(descriptions.$item).toContain('current $each entry');
    expect(descriptions.$context).toContain('/slide/index');
    expect(descriptions.$context).not.toContain('/section/tracker');
    expect(descriptions.$if).toContain('zero selects then');
  });
  it.each([
    ['{"name":"text","props":{"text":{|}}}', ['$join']],
    [
      '{"name":"text","props":{"text":{"$join":[],|}}}',
      ['separator', 'keepEmpty'],
    ],
    ['{"name":"text","props":{"fontSize":{|}}}', ['$count', '$measure']],
    [
      '{"name":"text","props":{"x":{"$measure":"width",|}}}',
      ['fraction', 'unit'],
    ],
  ])('describes scalar bindings and options: %s', async (body, fields) => {
    const { labels, descriptions } = await inspect(documentWithBody(body));
    for (const field of fields) {
      expect(labels).toContain(field);
      expect(descriptions[field], field).toBeTruthy();
    }
  });
  it('describes $measure as the slide canvas', async () => {
    const { descriptions } = await inspect(
      documentWithBody('{"name":"text","props":{"x":{|}}}')
    );
    expect(descriptions.$measure).toContain('slide');
    expect(descriptions.$measure).not.toContain('section');
  });
  it('preserves plugin property descriptions through binding wrappers', async () => {
    const { descriptions } = await inspect(
      documentWithBody('{"name":"weather","props":{|}}')
    );
    expect(descriptions.city).toBe('City to look up.');
  });
  it.each([
    '{"|"}',
    '{"slots":{"title":{|}},"body":[]}',
    '{"slots":{},"body":[],"slide":{|}}',
  ])(
    'describes block definitions, slots and slide settings: %s',
    async (definition) => {
      const { labels, descriptions } = await inspect(
        `{"name":"pptx","props":{"blocks":{"example":${definition}}},"children":[]}`
      );
      expect(labels.length).toBeGreaterThan(0);
      for (const label of labels)
        expect(descriptions[label], label).toBeTruthy();
    }
  );
  it.each([
    documentWithBody('{"name":"|"}'),
    documentWithBody('{"name":"group","children":[{"name":"|"}]}'),
    '{"name":"pptx","props":{"blocks":{"prova":{"body":[{"name":"|"}]}}},"children":[{"name":"slide","children":[]}]}',
    '{"name":"pptx","props":{},"children":[{"name":"slide","children":[{"name":"|"}]}]}',
  ])('describes each component choice specifically: %s', async (text) => {
    const { descriptions } = await inspect(text);
    expect(descriptions.text).toContain('Text');
    expect(descriptions.chart).toContain('chart');
    expect(descriptions.block).toContain('props.blocks');
    expect(descriptions.weather).toContain('Weather forecast for a city.');
    expect(
      new Set([
        descriptions.text,
        descriptions.chart,
        descriptions.block,
        descriptions.weather,
      ]).size
    ).toBe(4);
  });
  it('completes slide content, blocks, groups and registered plugins in a body', async () => {
    const { labels } = await inspect(documentWithBody('{"name":"|"}'));
    expect(labels).toEqual(
      expect.arrayContaining([
        'text',
        'shape',
        'chart',
        'image',
        'table',
        'block',
        'group',
        'weather',
      ])
    );
    expect(labels).not.toContain('pptx');
    expect(labels).not.toContain('slide');
  });
  it.each([
    ['text', 'text'],
    ['weather', 'city'],
    ['group', 'direction'],
  ])('completes %s properties', async (name, property) => {
    const { labels } = await inspect(
      documentWithBody(`{"name":"${name}","props":{|}}`)
    );
    expect(labels).toContain(property);
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
      documentWithBody('{"name":"text","props":{"text":{|}}}')
    );
    expect(labels).toEqual(expect.arrayContaining(['$slot', '$theme', '$if']));
  });
  it.each([
    '{"$if":"/subtitle","then":[{"name":"|"}]}',
    '{"$each":"/items","template":{"name":"|"}}',
    '{"name":"group","props":{"direction":"row"},"children":[{"name":"|"}]}',
    '{"name":"group","children":[{"$if":"/x","then":{"name":"|"}}]}',
  ])('completes components through nested composition: %s', async (body) => {
    expect((await inspect(documentWithBody(body))).labels).toContain('text');
  });
  it('accepts frames, fit and theme bindings in nested values without a format field', async () => {
    const body =
      '{"name":"group","props":{"x":"3.75%","y":"4.5%","w":"92.5%","h":"91%"},"children":[' +
      '{"name":"text","props":{"text":{"$slot":"/title"},"style":"display","fontSize":{"$theme":"/styles/display/fontSize","default":28},"x":"0%","y":"5%","w":"100%","h":"19%","fit":{"maxLines":2,"shrink":[24,22]}}},' +
      '{"name":"shape","props":{"type":"line","x":"0%","y":"26%","w":"100%","h":0,"line":{"color":{"$theme":"/palette/rule","default":"background2"},"width":0.5}}},' +
      '{"$slot":"/chart","props":{"x":"0%","y":"29%","w":"68%","h":"62%","chartColors":["accent","secondary"]}}' +
      ']}';
    expect((await inspect(documentWithBody(body))).diagnostics).toEqual([]);
  });
  it('does not allow block bindings in ordinary slide props', async () => {
    expect(
      (
        await inspect(
          '{"name":"pptx","props":{},"children":[{"name":"slide","children":[{"name":"text","props":{"text":{"$slot":"/title"}}}]}]}'
        )
      ).diagnostics.length
    ).toBeGreaterThan(0);
  });
  it('preserves literal prop validation in definitions', async () => {
    expect(
      (await inspect(documentWithBody('{"name":"text","props":{"text":42}}')))
        .diagnostics.length
    ).toBeGreaterThan(0);
  });
  it('uses the selected renderer’s component surface', async () => {
    const body = '{"name":"shape","props":{"type":"rect","flipV":true}}';
    expect((await inspect(documentWithBody(body))).diagnostics).toEqual([]);
    const pruned = await inspect(
      documentWithBody(body, '"renderer":"office-open",')
    );
    expect(pruned.diagnostics.map((item) => item.message)).toEqual([
      'Property flipV is not allowed.',
    ]);
  });
  it.each([
    'consulting-deck-blocks',
    'data-report-presentation',
    'management-plan',
    'minimalist-pitch-deck',
  ])('accepts the shipped %s deck without a diagnostic', async (name) => {
    expect((await inspect(shippedDeck(name))).diagnostics).toEqual([]);
  });
});
