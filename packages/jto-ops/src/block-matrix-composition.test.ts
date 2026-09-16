/**
 * The block matrix beyond the gallery (#343): definitions an author writes,
 * definitions that invoke other definitions, the same block invoked again,
 * and documents that mix blocks, registered code plugins and primitives —
 * in both formats.
 *
 * The clean documents must validate with their plugins registered and come
 * back from analysis with no warning and no preparation error, every finding
 * at a pointer the author wrote. Then one defect is injected at a time, into
 * a plugin's output, into a nested definition's slot, into the definitions
 * themselves, and each must come back as the coded diagnostic it is, at the
 * authored pointer that caused it: the invocation that ran the plugin, the
 * slot that carried the text, the `ref` inside the definition.
 */

import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { Type } from '@sinclair/typebox';
import { describe, expect, it } from 'vitest';
import { createComponent, createVersion } from '@json-to-office/core-docx';
import {
  createComponent as createPptxComponent,
  createVersion as createPptxVersion,
} from '@json-to-office/core-pptx';
import { blockValueAt } from '@json-to-office/shared';
import { DocxFormatAdapter, PptxFormatAdapter } from './format-adapter';

const TEMPLATES_DIR = path.resolve(
  __dirname,
  '../../jto/src/client/public/templates'
);
const template = (name: string) =>
  JSON.parse(readFileSync(path.join(TEMPLATES_DIR, name), 'utf8')) as {
    props: { blocks: Record<string, unknown> };
  };
const REPORT_BLOCKS = template('client-report-blocks.docx.json').props.blocks;

type Rec = Record<string, any>;

/** A report plugin: a short paragraph, or a skipped heading level when told. */
const ledger = createComponent({
  name: 'ledger',
  versions: {
    '1.0.0': createVersion({
      propsSchema: Type.Object(
        { entry: Type.String(), skipLevel: Type.Optional(Type.Boolean()) },
        { additionalProperties: false }
      ),
      render: async ({ props }) =>
        props.skipLevel
          ? [
              { name: 'heading', props: { text: 'Ledger', level: 1 } },
              { name: 'heading', props: { text: props.entry, level: 3 } },
            ]
          : [{ name: 'paragraph', props: { text: props.entry } }],
    }),
  },
});

/** A deck plugin: a stamp in the corner, legible unless told otherwise. */
const stamp = createPptxComponent({
  name: 'stamp',
  versions: {
    '1.0.0': createPptxVersion({
      propsSchema: Type.Object(
        { text: Type.String(), size: Type.Optional(Type.Number()) },
        { additionalProperties: false }
      ),
      render: async ({ props }) => [
        {
          name: 'text',
          props: {
            text: props.text,
            x: 1,
            y: 5.6,
            w: 6,
            h: 0.5,
            fontSize: props.size ?? 12,
          },
        },
      ],
    }),
  },
});

/**
 * A report an author assembled: a user-defined `finding` block that nests the
 * house `callout` (which composes from nothing) and the house `source-line`,
 * and runs the `ledger` plugin; invoked twice; primitives around it; the
 * plugin once more on its own.
 */
function report(overrides: { skipLevel?: boolean } = {}): Rec {
  return {
    name: 'docx',
    props: {
      theme: 'consulting',
      blocks: {
        callout: structuredClone(REPORT_BLOCKS.callout),
        'source-line': structuredClone(REPORT_BLOCKS['source-line']),
        finding: {
          description: 'A finding, its evidence and where it comes from.',
          slots: {
            claim: { type: 'string', required: true, maxWords: 30 },
            entry: { type: 'string', required: true, maxWords: 12 },
            source: { type: 'string', maxWords: 20, role: 'source' },
          },
          body: [
            {
              name: 'block',
              props: {
                ref: 'callout',
                slots: { label: 'Finding', text: { $slot: '/claim' } },
              },
            },
            {
              name: 'ledger',
              props: {
                entry: { $slot: '/entry' },
                ...(overrides.skipLevel && { skipLevel: true }),
              },
            },
            {
              $if: '/source',
              then: {
                name: 'block',
                props: {
                  ref: 'source-line',
                  slots: { text: { $slot: '/source' } },
                },
              },
            },
          ],
        },
      },
    },
    children: [
      {
        name: 'section',
        children: [
          { name: 'heading', props: { text: 'Findings', level: 1 } },
          {
            name: 'block',
            props: {
              ref: 'finding',
              slots: {
                claim:
                  'Delivery improved in every region after weekly reviews.',
                entry: 'Reviews held: 48 of 52 weeks.',
                source: 'Source: delivery tracker, 2026.',
              },
            },
          },
          {
            name: 'paragraph',
            props: { text: 'The second finding follows the same pattern.' },
          },
          {
            name: 'block',
            props: {
              ref: 'finding',
              slots: {
                claim: 'Retention held while prices rose four percent.',
                entry: 'Renewals: 94 of 100 accounts.',
              },
            },
          },
          { name: 'ledger', props: { entry: 'Closing balance recorded.' } },
        ],
      },
    ],
  };
}

/**
 * A deck an author assembled: a user-defined `note-card` that nests a
 * user-defined `source-note` and runs the `stamp` plugin, invoked on two
 * slides; a primitive beside it; the plugin on its own on a third.
 */
function deck(overrides: { stampSize?: number; noteSize?: number } = {}): Rec {
  return {
    name: 'pptx',
    props: {
      theme: 'consulting',
      slideWidth: 13.333,
      slideHeight: 7.5,
      blocks: {
        'source-note': {
          slots: {
            text: { type: 'string', required: true, maxWords: 12 },
            size: { type: 'number', default: 12 },
          },
          body: [
            {
              name: 'text',
              props: {
                text: { $slot: '/text' },
                x: 1,
                y: 6.4,
                w: 8,
                h: 0.4,
                fontSize: { $slot: '/size' },
              },
            },
          ],
        },
        'note-card': {
          slots: {
            title: {
              type: 'string',
              required: true,
              oneLine: true,
              maxWords: 8,
            },
            note: { type: 'string', required: true, maxWords: 30 },
            source: { type: 'string', required: true, maxWords: 12 },
          },
          body: [
            {
              name: 'text',
              props: {
                text: { $slot: '/title' },
                x: 1,
                y: 0.8,
                w: 11,
                h: 0.8,
                fontSize: 28,
              },
            },
            {
              name: 'text',
              props: {
                text: { $slot: '/note' },
                x: 1,
                y: 2,
                w: 11,
                h: 2.5,
                fontSize: 18,
              },
            },
            {
              name: 'block',
              props: {
                ref: 'source-note',
                slots: {
                  text: { $slot: '/source' },
                  ...(overrides.noteSize !== undefined && {
                    size: overrides.noteSize,
                  }),
                },
              },
            },
            {
              name: 'stamp',
              props: {
                text: 'Draft for discussion',
                ...(overrides.stampSize !== undefined && {
                  size: overrides.stampSize,
                }),
              },
            },
          ],
        },
      },
    },
    children: [1, 2]
      .map((n) => ({
        name: 'slide',
        children: [
          {
            name: 'block',
            props: {
              ref: 'note-card',
              slots: {
                title: `Finding ${n} holds across regions`,
                note: 'Weekly reviews moved delivery from 81 to 94 percent.',
                source: 'Source: delivery tracker, 2026.',
              },
            },
          },
          {
            name: 'text',
            props: {
              text: `Page note ${n}`,
              x: 9,
              y: 6.9,
              w: 3,
              h: 0.3,
              fontSize: 10,
            },
          },
        ],
      }))
      .concat([
        {
          name: 'slide',
          children: [{ name: 'stamp', props: { text: 'Appendix follows' } }],
        },
      ]),
  };
}

const docx = new DocxFormatAdapter();
const pptx = new PptxFormatAdapter();

async function judge(
  adapter: DocxFormatAdapter | PptxFormatAdapter,
  document: Rec,
  plugins: unknown[]
) {
  const validation = await adapter.validateDocumentWithPlugins(
    document,
    plugins as never
  );
  const analysis = await adapter.analyzeQuality(document, {
    plugins: plugins as never,
  });
  return { validation, analysis };
}

function unauthored(document: Rec, paths: (string | undefined)[]): string[] {
  return paths.filter(
    (p): p is string =>
      p !== undefined && blockValueAt(document, p) === undefined
  );
}

describe('a report an author assembled from blocks, plugins and primitives', () => {
  it('validates with its plugin and analyses clean, at authored pointers', async () => {
    const document = report();
    const { validation, analysis } = await judge(docx, document, [ledger]);
    expect(validation.errors ?? []).toEqual([]);
    expect(analysis.ruleErrors ?? []).toEqual([]);
    expect(
      analysis.diagnostics
        .filter((d) => d.severity === 'warning')
        .map((d) => `${d.code} at ${d.path}`)
    ).toEqual([]);
    expect(
      unauthored(
        document,
        analysis.diagnostics.map((d) => d.path)
      )
    ).toEqual([]);
    // Both invocations of the same block, and the plugin used directly,
    // carry facts of their own.
    const prepared = await docx.prepareDocument(document, {
      plugins: [ledger] as never,
    });
    const paths = new Set(prepared.facts.map((fact) => fact.path));
    for (const pointer of [
      '/children/0/children/1',
      '/children/0/children/3',
      '/children/0/children/4',
    ])
      expect(
        [...paths].some((p) => p.startsWith(pointer)),
        pointer
      ).toBe(true);
  });

  it('reports what the nested plugin emits at the invocation that ran it', async () => {
    const document = report({ skipLevel: true });
    const { analysis } = await judge(docx, document, [ledger]);
    expect(
      analysis.diagnostics
        .filter((d) => d.code === 'W_QUALITY_HEADING_SKIP')
        .map((d) => d.path)
        .sort()
    ).toEqual(['/children/0/children/1', '/children/0/children/3']);
  });

  it('reports a nested definition past its budget at the slot of the outer invocation', async () => {
    const document = report();
    document.children[0].children[1].props.slots.claim = Array.from(
      { length: 70 },
      (_, i) => `word${i}`
    ).join(' ');
    const { validation } = await judge(docx, document, [ledger]);
    expect(
      (validation.errors ?? []).map((e: Rec) => `${e.code} ${e.path}`)
    ).toContain('block_slot_budget /children/0/children/1/props/slots/claim');
  });
});

describe('a deck an author assembled from blocks, plugins and primitives', () => {
  it('validates with its plugin and analyses clean, at authored pointers', async () => {
    const document = deck();
    const { validation, analysis } = await judge(pptx, document, [stamp]);
    expect(validation.errors ?? []).toEqual([]);
    expect(analysis.ruleErrors ?? []).toEqual([]);
    expect(
      analysis.diagnostics
        .filter((d) => d.severity === 'warning')
        .map((d) => `${d.code} at ${d.path}`)
    ).toEqual([]);
    expect(
      unauthored(
        document,
        analysis.diagnostics.map((d) => d.path)
      )
    ).toEqual([]);
  });

  it('reports small print a nested plugin emits at each invocation that ran it', async () => {
    const document = deck({ stampSize: 5 });
    const { analysis } = await judge(pptx, document, [stamp]);
    expect(
      analysis.diagnostics
        .filter((d) => d.code === 'W_QUALITY_FONT_SIZE_MIN')
        .map((d) => d.path)
        .sort()
    ).toEqual(['/children/0/children/0', '/children/1/children/0']);
  });

  it('reports small print a nested definition draws at an authored pointer, not the plugin used alone', async () => {
    const document = deck({ noteSize: 5 });
    const { analysis } = await judge(pptx, document, [stamp]);
    const small = analysis.diagnostics.filter(
      (d) => d.code === 'W_QUALITY_FONT_SIZE_MIN'
    );
    expect(small.map((d) => d.path).sort()).toEqual([
      '/children/0/children/0',
      '/children/1/children/0',
    ]);
    expect(
      unauthored(
        document,
        small.map((d) => d.path)
      )
    ).toEqual([]);
  });
});

describe('a malformed definition is a coded issue at the definition', () => {
  for (const [format, build, adapter, plugins] of [
    ['docx', report, docx, [ledger]],
    ['pptx', deck, pptx, [stamp]],
  ] as const) {
    const outer = format === 'docx' ? 'finding' : 'note-card';
    const inner = format === 'docx' ? 'callout' : 'source-note';

    it(`${format}: a body that names a block the document lacks`, async () => {
      const document = build();
      delete document.props.blocks[inner];
      const { validation, analysis } = await judge(
        adapter as never,
        document,
        plugins as unknown as unknown[]
      );
      expect(
        (validation.errors ?? [])
          .filter((e: Rec) => e.code === 'block_unknown_reference')
          .map((e: Rec) => e.path)
      ).toEqual([
        `/props/blocks/${outer}/body/${format === 'docx' ? 0 : 2}/props/ref`,
      ]);
      expect((analysis.ruleErrors ?? []).length).toBeGreaterThan(0);
    });

    it(`${format}: a definition that reaches itself on every expansion`, async () => {
      const document = build();
      const innerDefinition = document.props.blocks[inner];
      innerDefinition.body = [
        ...(innerDefinition.body as unknown[]),
        { name: 'block', props: { ref: outer, slots: {} } },
      ];
      const { validation } = await judge(
        adapter as never,
        document,
        plugins as unknown as unknown[]
      );
      const cycles = (validation.errors ?? []).filter(
        (e: Rec) => e.code === 'block_expansion_limit'
      );
      // Named once, at whichever of the two refs closes the loop the walk
      // found first.
      expect(cycles).toHaveLength(1);
      expect([
        `/props/blocks/${inner}/body/${innerDefinition.body.length - 1}/props/ref`,
        `/props/blocks/${outer}/body/${format === 'docx' ? 0 : 2}/props/ref`,
      ]).toContain(cycles[0].path);
      expect(cycles[0].message).toMatch(
        new RegExp(
          `${outer} → ${inner} → ${outer}|${inner} → ${outer} → ${inner}`
        )
      );
    });

    it(`${format}: a slot type the definition language does not have`, async () => {
      const document = build();
      document.props.blocks[outer].slots.title = { type: 'date' };
      const { validation } = await judge(
        adapter as never,
        document,
        plugins as unknown as unknown[]
      );
      expect(
        (validation.errors ?? []).map((e: Rec) => `${e.code} ${e.path}`)
      ).toContain(
        `block_invalid_definition /props/blocks/${outer}/slots/title/type`
      );
    });
  }
});
