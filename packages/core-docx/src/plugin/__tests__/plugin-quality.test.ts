/**
 * Code-plugin output reaches quality analysis (#453): `prepareQuality`
 * expands registered components the way generation does, so a static rule
 * judges what a plugin emitted and the finding lands on the invocation the
 * author wrote — directly in the document, or inside a block definition.
 */
import { describe, expect, it } from 'vitest';
import { Type } from '@sinclair/typebox';
import { QUALITY_CODES } from '@json-to-office/quality';
import { createComponent } from '../createComponent';
import { createDocumentGenerator } from '../createDocumentGenerator';
import { analyzeDocxQuality } from '../../quality/preflight';

/** Emits a revenue table whose figures sit centred and left. */
const revenueTable = createComponent({
  name: 'revenue-table',
  versions: {
    '1.0.0': {
      propsSchema: Type.Object({ label: Type.String() }),
      render: async ({ props }) => [
        {
          name: 'table',
          props: {
            columns: [
              {
                header: { content: props.label },
                cells: [{ content: 'Retail' }, { content: 'Wholesale' }],
              },
              {
                header: { content: 'Revenue' },
                cells: [
                  { content: '12.0', horizontalAlignment: 'center' },
                  { content: '15.5' },
                ],
              },
            ],
          },
        },
      ],
    },
  },
});

const generator = () => createDocumentGenerator({}).addComponent(revenueTable);

const numericAlign = (analysis: ReturnType<typeof analyzeDocxQuality>) =>
  analysis.diagnostics.filter(
    (finding) => finding.code === QUALITY_CODES.TABLE_NUMERIC_ALIGN
  );

describe('quality analysis of registered components', () => {
  it('judges what a plugin emits and reports it at the invocation', async () => {
    const document = {
      name: 'docx',
      props: {},
      children: [
        { name: 'paragraph', props: { text: 'Revenue by segment.' } },
        { name: 'revenue-table', props: { label: 'Segment' } },
      ],
    };
    // Without the plugin the analysis cannot see into the invocation.
    expect(numericAlign(analyzeDocxQuality(document))).toEqual([]);

    const { prepared } = await generator().prepareQuality(document as never);
    const findings = numericAlign(analyzeDocxQuality(document, { prepared }));
    expect(findings).toEqual([
      expect.objectContaining({ path: '/children/1' }),
    ]);
    // The author wrote the invocation, not the table: nothing to patch.
    expect(findings[0].fixes).toBeUndefined();
  });

  it('reports a plugin a block definition invokes at the block invocation', async () => {
    const document = {
      name: 'docx',
      props: {
        blocks: {
          exhibit: {
            slots: { label: { type: 'string', required: true } },
            body: [
              {
                name: 'revenue-table',
                props: { label: { $slot: '/label' } },
              },
            ],
          },
        },
      },
      children: [
        { name: 'paragraph', props: { text: 'Revenue by segment.' } },
        {
          name: 'block',
          props: { ref: 'exhibit', slots: { label: 'Segment' } },
        },
      ],
    };
    const { prepared } = await generator().prepareQuality(document as never);
    expect(numericAlign(analyzeDocxQuality(document, { prepared }))).toEqual([
      expect.objectContaining({ path: '/children/1' }),
    ]);
  });

  it('keeps the block facts of a document that also registers plugins', async () => {
    const document = {
      name: 'docx',
      props: {
        blocks: {
          note: {
            slots: {
              text: { type: 'string', required: true },
              source: { type: 'string', role: 'source' },
            },
            body: [{ name: 'paragraph', props: { text: { $slot: '/text' } } }],
          },
        },
      },
      children: [
        { name: 'block', props: { ref: 'note', slots: { text: 'A note.' } } },
        { name: 'revenue-table', props: { label: 'Segment' } },
      ],
    };
    const { prepared } = await generator().prepareQuality(document as never);
    const codes = analyzeDocxQuality(document, {
      prepared,
      policy: {
        rules: {
          'docx/required-chrome': { parameters: { required: ['source'] } },
        },
      },
    }).diagnostics.map((finding) => `${finding.code} ${finding.path}`);
    expect(codes).toContain(
      `${QUALITY_CODES.CHROME_MISSING} /children/0/props/slots/source`
    );
    expect(codes).toContain(`${QUALITY_CODES.TABLE_NUMERIC_ALIGN} /children/1`);
  });
  it('validates a top-level plugin section at the document root', async () => {
    // The combined expansion path supplies a source path for every plugin,
    // and wrapping a document child's output in a synthetic section would
    // make a valid `section` a section inside a section.
    const sectionPlugin = createComponent({
      name: 'appendix-section',
      versions: {
        '1.0.0': {
          propsSchema: Type.Object({ heading: Type.String() }),
          render: async ({ props }) => [
            {
              name: 'section',
              props: {},
              children: [
                { name: 'heading', props: { text: props.heading, level: 1 } },
              ],
            },
          ],
        },
      },
    });
    const document = {
      name: 'docx',
      props: {},
      children: [{ name: 'appendix-section', props: { heading: 'Appendix' } }],
    };
    const generated = createDocumentGenerator({}).addComponent(sectionPlugin);
    await expect(
      generated.prepareQuality(document as never)
    ).resolves.toBeDefined();
    await expect(
      generated.generateBuffer(document as never)
    ).resolves.toBeDefined();
  });
  it('renders the expansion the quality gate inspected, not a second one', async () => {
    // A plugin whose output changes on every call: if the render expanded it
    // again, the bytes would carry a paragraph the analysis never judged.
    let call = 0;
    const counter = createComponent({
      name: 'call-counter',
      versions: {
        '1.0.0': {
          propsSchema: Type.Object({}),
          render: async () => [
            { name: 'paragraph', props: { text: `Call ${++call}.` } },
          ],
        },
      },
    });
    const document = {
      name: 'docx',
      props: {},
      children: [{ name: 'call-counter', props: {} }],
    };
    const generated = createDocumentGenerator({}).addComponent(counter);
    const { prepared } = await generated.prepareQuality(document as never);
    expect(call).toBe(1);
    const { standardDefinition } = await generated.generateBuffer(
      document as never,
      { prepared }
    );
    expect(call, 'the plugin rendered once for both').toBe(1);
    expect(JSON.stringify(standardDefinition)).toContain('Call 1.');
    // Without the prepared model the plugin runs again, as it always has.
    await generated.generateBuffer(document as never);
    expect(call).toBe(2);
  });
});
