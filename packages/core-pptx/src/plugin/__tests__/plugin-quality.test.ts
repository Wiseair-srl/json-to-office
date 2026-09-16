/**
 * Code-plugin output reaches quality analysis (#453): `prepareQuality`
 * expands registered components the way generation does, so a static rule
 * judges what a plugin emitted and the finding lands on the invocation the
 * author wrote — on a slide, or inside a block definition.
 */
import { describe, expect, it } from 'vitest';
import { Type } from '@sinclair/typebox';
import { QUALITY_CODES } from '@json-to-office/quality';
import {
  createComponent,
  createVersion,
  createPresentationGenerator,
} from '../index';
import { analyzePptxQuality } from '../../quality/preflight';

/** Emits a footnote set at a size nobody can read from the back of a room. */
const footnote = createComponent({
  name: 'footnote' as const,
  versions: {
    '1.0.0': createVersion({
      propsSchema: Type.Object(
        { text: Type.String() },
        { additionalProperties: false }
      ),
      render: async ({ props }) => [
        {
          name: 'text',
          props: {
            text: props.text,
            x: 0.5,
            y: 6.8,
            w: 9,
            h: 0.4,
            fontSize: 5,
          },
        },
      ],
    }),
  },
});

const generator = () => createPresentationGenerator({}).addComponent(footnote);
const CANVAS = { slideWidth: 13.333, slideHeight: 7.5 };

const tooSmall = (analysis: ReturnType<typeof analyzePptxQuality>) =>
  analysis.diagnostics.filter(
    (finding) => finding.code === QUALITY_CODES.FONT_SIZE_MIN
  );

describe('quality analysis of registered components', () => {
  it('judges what a plugin emits and reports it at the invocation', async () => {
    const document = {
      name: 'pptx',
      props: CANVAS,
      children: [
        {
          name: 'slide',
          children: [
            {
              name: 'text',
              props: { text: 'Revenue grew', x: 0.5, y: 0.5, w: 9, h: 1 },
            },
            { name: 'footnote', props: { text: 'Source: internal data.' } },
          ],
        },
      ],
    };
    // Without the plugin the analysis cannot see into the invocation.
    expect(tooSmall(analyzePptxQuality(document))).toEqual([]);

    const { prepared } = await generator().prepareQuality(document as never);
    expect(tooSmall(analyzePptxQuality(document, { prepared }))).toEqual([
      expect.objectContaining({ path: '/children/0/children/1' }),
    ]);
  });

  it('reports a plugin a block definition invokes at the block invocation', async () => {
    const document = {
      name: 'pptx',
      props: {
        ...CANVAS,
        blocks: {
          sourced: {
            slots: { note: { type: 'string', required: true } },
            body: [{ name: 'footnote', props: { text: { $slot: '/note' } } }],
          },
        },
      },
      children: [
        {
          name: 'slide',
          children: [
            {
              name: 'text',
              props: { text: 'Revenue grew', x: 0.5, y: 0.5, w: 9, h: 1 },
            },
            {
              name: 'block',
              props: { ref: 'sourced', slots: { note: 'Source: internal.' } },
            },
          ],
        },
      ],
    };
    const { prepared } = await generator().prepareQuality(document as never);
    expect(tooSmall(analyzePptxQuality(document, { prepared }))).toEqual([
      expect.objectContaining({ path: '/children/0/children/1' }),
    ]);
  });
});
