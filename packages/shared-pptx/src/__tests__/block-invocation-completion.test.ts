/**
 * Block references and slots through the real JSON language service.
 *
 * The published schema cannot name one document's blocks, so the playground
 * installs a copy of it with the document's own definitions applied on every
 * change (`applyDocumentBlocksToSchema`). These tests prove what that copy
 * gives the editor: the defined names complete at `ref` with their
 * descriptions, the selected block's slots complete with descriptions,
 * defaults and constraints, a component slot completes against the renderer's
 * surface, and a wrong slot, a missing required one or smuggled placement is
 * flagged inline — the same verdicts the runtime validator reaches.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ClientCapabilities,
  getLanguageService,
  TextDocument,
} from 'vscode-json-languageservice';
import {
  applyDocumentBlocksToSchema,
  type JsonBlockDefinition,
} from '@json-to-office/shared';
import {
  convertToJsonSchema,
  generateUnifiedDocumentSchema,
  preparePptxDocumentBlockTargets,
} from '../index';

const published = convertToJsonSchema(
  generateUnifiedDocumentSchema({ customComponents: [] })
);
const deck = () =>
  JSON.parse(
    readFileSync(
      new URL(
        '../../../jto/src/client/public/templates/consulting-deck-blocks.pptx.json',
        import.meta.url
      ),
      'utf8'
    )
  );

/** The schema the playground installs for a document with these blocks. */
function documentSchema(definitions: Record<string, JsonBlockDefinition>) {
  const schema = JSON.parse(JSON.stringify(published));
  applyDocumentBlocksToSchema(
    schema,
    definitions,
    preparePptxDocumentBlockTargets(schema)
  );
  return schema;
}

/**
 * `text` may be partial — `{"|"}` is an object with an unfinished key — so
 * the definitions the schema is built from are passed in, defaulting to the
 * shipped deck's.
 */
async function inspect(
  text: string,
  definitions: Record<string, JsonBlockDefinition> = deck().props.blocks
) {
  const schema = documentSchema(definitions);
  const offset = text.indexOf('|');
  // What Monaco's JSON worker declares: markdown documentation, so a slot's
  // contract line reaches the completion item and the hover.
  const ls = getLanguageService({
    clientCapabilities: ClientCapabilities.LATEST,
  });
  ls.configure({
    schemas: [{ uri: 'test://document-blocks', fileMatch: ['*.json'], schema }],
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
  const hover =
    offset < 0 ? null : await ls.doHover(doc, doc.positionAt(offset), parsed);
  const contents = hover?.contents;
  return {
    hover: Array.isArray(contents)
      ? contents
          .map((entry) => (typeof entry === 'string' ? entry : entry.value))
          .join('\n')
      : typeof contents === 'object' && contents && 'value' in contents
        ? contents.value
        : '',
    labels: completions.map((item) => item.label.replace(/"/g, '')),
    descriptions: Object.fromEntries(
      completions.map((item) => [
        item.label.replace(/"/g, ''),
        typeof item.documentation === 'string'
          ? item.documentation
          : item.documentation?.value ?? '',
      ])
    ),
    inserts: Object.fromEntries(
      completions.map((item) => [
        item.label.replace(/"/g, ''),
        item.textEdit && 'newText' in item.textEdit
          ? item.textEdit.newText
          : item.insertText ?? '',
      ])
    ),
    messages: (await ls.doValidation(doc, parsed)).map((item) => item.message),
  };
}

/** The shipped deck with its first invocation replaced by `invocation`. */
function withInvocation(invocation: string): string {
  const document = deck();
  document.children = [{ name: 'slide', children: ['@@'] }];
  return JSON.stringify(document).replace('"@@"', invocation);
}
const definitions = () => deck().props.blocks;

describe('document-local block invocations through the language service', () => {
  it('completes the document’s block names at ref, described from the definition', async () => {
    const { labels, descriptions } = await inspect(
      withInvocation('{"name":"block","props":{"ref":"|"}}')
    );
    expect(labels).toEqual(['action-chart']);
    expect(descriptions['action-chart']).toBe(
      definitions()['action-chart'].description
    );
  });
  it('completes a second, document-local definition beside the shipped one', async () => {
    const document = deck();
    document.props.blocks.statement = {
      description: 'One sentence on an empty slide.',
      slots: { text: { type: 'string', required: true, maxWords: 30 } },
      body: [
        {
          name: 'text',
          props: { text: { $slot: '/text' }, x: 1, y: 2, w: 8, h: 2 },
        },
      ],
    };
    document.children = [{ name: 'slide', children: ['@@'] }];
    const text = (invocation: string) =>
      JSON.stringify(document).replace('"@@"', invocation);
    const { labels, descriptions } = await inspect(
      text('{"name":"block","props":{"ref":"|"}}'),
      document.props.blocks
    );
    expect(labels).toEqual(['action-chart', 'statement']);
    expect(descriptions.statement).toBe('One sentence on an empty slide.');
    const slots = await inspect(
      text('{"name":"block","props":{"ref":"statement","slots":{"|"}}}'),
      document.props.blocks
    );
    expect(slots.labels).toEqual(['text']);
    expect(slots.descriptions.text).toContain('Required');
    expect(slots.descriptions.text).toContain('30 words');
  });
  it('completes the selected block’s slots with descriptions, defaults and constraints', async () => {
    const { labels, descriptions, inserts } = await inspect(
      withInvocation(
        '{"name":"block","props":{"ref":"action-chart","slots":{"|"}}}'
      )
    );
    expect(labels.sort()).toEqual(
      ['chart', 'source', 'takeaway', 'title', 'tracker'].sort()
    );
    const slots = definitions()['action-chart'].slots;
    expect(descriptions.title).toContain(slots.title.description);
    expect(descriptions.title).toContain('Required');
    expect(descriptions.title).toContain('at most 24 words');
    expect(descriptions.title).toContain('one line');
    expect(descriptions.title).toContain('Role: actionTitle');
    expect(descriptions.chart).toContain('placement stays in the definition');
    expect(descriptions.source).not.toContain('Required');
    expect(inserts.title).toContain('"title"');
  });
  it('shows a slot default in the hover text and inserts it', async () => {
    const document = deck();
    document.props.blocks['action-chart'].slots.tracker.default = 'Overview';
    document.children = [
      {
        name: 'slide',
        children: [
          { name: 'block', props: { ref: 'action-chart', slots: { '@@': 1 } } },
        ],
      },
    ];
    const text = JSON.stringify(document).replace('"@@":1', '"|"');
    const { descriptions, inserts } = await inspect(
      text,
      document.props.blocks
    );
    expect(descriptions.tracker).toContain('Default: `"Overview"`');
    expect(inserts.tracker).toContain('Overview');
  });
  it('hovers a slot key with its description and contract', async () => {
    const { hover } = await inspect(
      withInvocation(
        '{"name":"block","props":{"ref":"action-chart","slots":{"ti|tle":"Growth"}}}'
      )
    );
    expect(hover).toContain(
      definitions()['action-chart'].slots.title.description
    );
    expect(hover).toContain('Required · at most 24 words · one line');
    expect(hover).toContain('Role: actionTitle');
  });
  it('completes a block placed inside a component slot', async () => {
    const { labels } = await inspect(
      withInvocation(
        '{"name":"block","props":{"ref":"action-chart","slots":{"chart":{"name":"block","props":{"ref":"|"}}}}}'
      )
    );
    expect(labels).toEqual(['action-chart']);
    const slots = await inspect(
      withInvocation(
        '{"name":"block","props":{"ref":"action-chart","slots":{"chart":{"name":"block","props":{"ref":"action-chart","slots":{"|"}}}}}}'
      )
    );
    expect(slots.labels).toContain('takeaway');
  });
  it('completes a component slot against the renderer surface, props included', async () => {
    const chart = await inspect(
      withInvocation(
        '{"name":"block","props":{"ref":"action-chart","slots":{"chart":{"name":"|"}}}}'
      )
    );
    expect(chart.labels).toEqual(
      expect.arrayContaining(['chart', 'highcharts', 'text', 'image'])
    );
    expect(chart.labels).not.toContain('slide');
    const props = await inspect(
      withInvocation(
        '{"name":"block","props":{"ref":"action-chart","slots":{"chart":{"name":"chart","props":{|}}}}}'
      )
    );
    expect(props.labels).toEqual(expect.arrayContaining(['type', 'data']));
  });
  it('accepts the shipped invocations without a diagnostic', async () => {
    expect((await inspect(JSON.stringify(deck()))).messages).toEqual([]);
  });
  it.each([
    [
      'an unknown reference',
      '{"name":"block","props":{"ref":"kpi-row"}}',
      ['Value must be "action-chart".'],
    ],
    [
      'a missing required slot',
      '{"name":"block","props":{"ref":"action-chart","slots":{"title":"Growth"}}}',
      ['Missing property "chart".'],
    ],
    [
      'an undeclared slot',
      '{"name":"block","props":{"ref":"action-chart","slots":{"title":"Growth","chart":{"name":"chart","props":{"type":"bar","data":[{"name":"Revenue","labels":["Q1"],"values":[4]}]}},"footnote":"x"}}}',
      ['Property footnote is not allowed.'],
    ],
    [
      'a slot of the wrong type',
      '{"name":"block","props":{"ref":"action-chart","slots":{"title":42,"chart":{"name":"chart","props":{"type":"bar","data":[{"name":"Revenue","labels":["Q1"],"values":[4]}]}}}}}',
      ['Incorrect type. Expected "string".'],
    ],
    [
      'a multi-line value in a one-line slot',
      '{"name":"block","props":{"ref":"action-chart","slots":{"title":"Two\\nlines","chart":{"name":"chart","props":{"type":"bar","data":[{"name":"Revenue","labels":["Q1"],"values":[4]}]}}}}}',
      ['String does not match the pattern of "^[^\\r\\n]*$".'],
    ],
    [
      'placement smuggled through a component slot',
      '{"name":"block","props":{"ref":"action-chart","slots":{"title":"Growth","chart":{"name":"chart","props":{"type":"bar","data":[{"name":"Revenue","labels":["Q1"],"values":[4]}],"x":1}}}}}',
      ['Block placement belongs in the definition, not in a component slot.'],
    ],
    [
      'a coordinate on the invocation itself',
      '{"name":"block","props":{"ref":"action-chart","x":1,"slots":{"title":"Growth","chart":{"name":"chart","props":{"type":"bar","data":[{"name":"Revenue","labels":["Q1"],"values":[4]}]}}}}}',
      ['Property x is not allowed.'],
    ],
  ])('flags %s inline', async (_case, invocation, expected) => {
    expect((await inspect(withInvocation(invocation))).messages).toEqual(
      expected
    );
  });
  it('keeps a reference free and unflagged while the document defines nothing', async () => {
    const document = deck();
    delete document.props.blocks;
    expect((await inspect(JSON.stringify(document), {})).messages).toEqual([]);
    expect(
      (
        await inspect(
          withInvocation('{"name":"block","props":{"ref":"|"}}'),
          {}
        )
      ).labels
    ).toEqual([]);
  });
  it('flags a body-level invocation through the derived schema, not the document one', async () => {
    // Inside a definition, a nested invocation may bind its slots — the
    // document-aware dispatch applies to authored slides only.
    const document = deck();
    document.props.blocks.wrapper = {
      slots: { heading: { type: 'string', required: true } },
      body: [
        {
          name: 'block',
          props: {
            ref: 'action-chart',
            slots: { title: { $slot: '/heading' }, chart: { $slot: '/chart' } },
          },
        },
      ],
    };
    expect(
      (await inspect(JSON.stringify(document), document.props.blocks)).messages
    ).toEqual([]);
  });
});
