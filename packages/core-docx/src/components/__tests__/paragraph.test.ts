/**
 * The prop shapes a `paragraph` has to accept.
 *
 * A catalogue, not a set of behaviour checks: the corpus pins what each of
 * these produces down to the byte, so what is left to say here is that every
 * shape compiles, and compiles to exactly one paragraph. A shape that starts
 * throwing, or that quietly becomes two blocks, fails here first — which is
 * where it is easiest to read.
 */

import { describe, it, expect } from 'vitest';
import { compileDocumentToIr } from '../../core/generateFromIr';
import type { ReportComponentDefinition } from '../../types';

async function paragraphBlocks(props: Record<string, unknown>) {
  const compiled = await compileDocumentToIr({
    name: 'docx',
    props: { theme: 'minimal' },
    children: [{ name: 'paragraph', props }],
  } as unknown as ReportComponentDefinition);
  return compiled.ir.sections[0].children;
}

/** Every wrap type the authoring surface accepts, including the VML spellings. */
const WRAP_TYPES = [
  'around',
  'none',
  'notBeside',
  'through',
  'tight',
  'auto',
] as const;

const CASES: Array<[string, Record<string, unknown>]> = [
  ['simple text', { text: 'Simple text content' }],
  ['empty text', { text: '' }],
  ['multiline text', { text: 'Line 1\nLine 2\nLine 3' }],
  [
    'font styles',
    {
      text: 'Styled text',
      font: { family: 'Arial', bold: true, italic: true, underline: true },
    },
  ],
  [
    'a colour',
    { text: 'Colored text', font: { family: 'Arial', color: '#FF0000' } },
  ],
  ['a font size', { text: 'Sized text', font: { family: 'Arial', size: 18 } }],
  ['a font family', { text: 'Familied text', font: { family: 'Georgia' } }],
  ['a theme style', { text: 'Themed text', themeStyle: 'title' }],
  [
    'spacing',
    { text: 'Text with spacing', spacing: { before: 120, after: 240 } },
  ],
  [
    'a floating box positioned by alignment',
    {
      text: 'Floating text',
      floating: {
        horizontalPosition: { relative: 'margin', align: 'right' },
        verticalPosition: { relative: 'page', align: 'top' },
        wrap: { type: 'around' },
      },
    },
  ],
  [
    'a floating box positioned by offset',
    {
      text: 'Floating text with offset',
      floating: {
        horizontalPosition: { relative: 'page', offset: 1440 },
        verticalPosition: { relative: 'page', offset: 720 },
        wrap: { type: 'none' },
      },
    },
  ],
  [
    'a floating box with its own size',
    {
      text: 'Floating text with size',
      floating: {
        horizontalPosition: { relative: 'margin', align: 'center' },
        verticalPosition: { relative: 'page', align: 'center' },
        wrap: { type: 'tight' },
        width: 2880,
        height: 1440,
      },
    },
  ],
  [
    'a floating box with a locked anchor',
    {
      text: 'Floating text with locked anchor',
      floating: {
        horizontalPosition: { relative: 'paragraph', align: 'left' },
        verticalPosition: { relative: 'paragraph', align: 'top' },
        wrap: { type: 'around' },
        lockAnchor: true,
      },
    },
  ],
  [
    'a floating box with no wrap stated',
    {
      text: 'Floating text without wrap',
      floating: {
        horizontalPosition: { relative: 'page', align: 'center' },
        verticalPosition: { relative: 'page', align: 'center' },
      },
    },
  ],
];

describe('components/paragraph', () => {
  it.each(CASES)('compiles a paragraph with %s', async (_name, props) => {
    const blocks = await paragraphBlocks(props);

    expect(blocks).toHaveLength(1);
    expect(blocks[0].kind).toBe('paragraph');
  });

  it.each(WRAP_TYPES)(
    'compiles a floating paragraph wrapping %s',
    async (type) => {
      const blocks = await paragraphBlocks({
        text: `Floating text with ${type} wrap`,
        floating: {
          horizontalPosition: { relative: 'margin', align: 'left' },
          verticalPosition: { relative: 'page', align: 'top' },
          wrap: { type },
        },
      });

      expect(blocks).toHaveLength(1);
      expect(blocks[0].kind).toBe('paragraph');
    }
  );

  it('positions a floating paragraph as a frame, not as an anchored drawing', async () => {
    const [block] = await paragraphBlocks({
      text: 'Framed.',
      floating: {
        horizontalPosition: { relative: 'page', offset: 1440 },
        verticalPosition: { relative: 'page', offset: 720 },
        width: 2880,
        height: 1440,
      },
    });

    expect(block.kind).toBe('paragraph');
    if (block.kind !== 'paragraph') return;
    // Twips, not EMU: a frame moves the paragraph itself.
    expect(block.frame).toEqual(
      expect.objectContaining({
        widthTwips: 2880,
        heightTwips: 1440,
        xTwips: 1440,
        yTwips: 720,
      })
    );
  });
});
