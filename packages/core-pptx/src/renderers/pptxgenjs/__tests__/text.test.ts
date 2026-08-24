import type PptxGenJS from 'pptxgenjs';
import { describe, expect, it } from 'vitest';
import { compileDocumentToIr } from '../../../core/generateFromIr';
import type {
  PptxThemeConfig,
  PresentationComponentDefinition,
} from '../../../types';
import type { PptxIrTextBoxElement } from '../../../ir/types';
import { emitTextBox } from '../emit';

const theme: PptxThemeConfig = {
  name: 'test',
  colors: {
    primary: '#0066cc',
    secondary: '#6c757d',
    accent: '#17a2b8',
    background: '#FFFFFF',
    text: '#000000',
  },
  fonts: { heading: 'Arial', body: 'Arial' },
  defaults: { fontSize: 18, fontColor: '#000000' },
};

async function compileTextBox(
  props: Record<string, unknown>
): Promise<PptxIrTextBoxElement> {
  const document = {
    name: 'pptx',
    props: { theme },
    children: [
      {
        name: 'slide',
        props: {},
        children: [{ name: 'text', props }],
      },
    ],
  } as PresentationComponentDefinition;
  const { ir } = await compileDocumentToIr(document);
  return ir.slides[0].elements[0] as PptxIrTextBoxElement;
}

type Segment = { text: string; options: Record<string, unknown> };
type AddTextCall = [
  content: string | Segment[],
  options: Record<string, unknown>,
];

function emitCall(element: PptxIrTextBoxElement): AddTextCall {
  const calls: AddTextCall[] = [];
  const slide = {
    addText: (content: unknown, options: unknown) => {
      calls.push([
        content as string | Segment[],
        options as Record<string, unknown>,
      ]);
    },
  } as unknown as PptxGenJS.Slide;
  emitTextBox(slide, element, {
    pptx: {} as PptxGenJS,
    resources: new Map(),
  });
  expect(calls).toHaveLength(1);
  return calls[0];
}

describe('PptxGenJS text adapter', () => {
  it('maps rich runs and keeps body defaults on the block', async () => {
    const [content, opts] = emitCall(
      await compileTextBox({
        x: 1,
        y: 1,
        w: 4,
        h: 1,
        runs: [
          { text: '27', fontSize: 27, bold: true, color: 'primary' },
          {
            text: ' pts',
            italic: true,
            underline: true,
            breakLine: true,
          },
        ],
      })
    );
    expect(content).toEqual([
      {
        text: '27',
        options: expect.objectContaining({
          fontFace: 'Arial',
          fontSize: 27,
          color: '0066CC',
          bold: true,
        }),
      },
      {
        text: ' pts',
        options: expect.objectContaining({
          fontFace: 'Arial',
          color: '000000',
          italic: true,
          underline: { style: 'sng' },
          breakLine: true,
        }),
      },
    ]);
    expect(opts).toMatchObject({
      x: 1,
      y: 1,
      w: 4,
      h: 1,
      fontFace: 'Arial',
      fontSize: 18,
      color: '000000',
    });
  });

  it('passes plain text as a string', async () => {
    const [content, opts] = emitCall(
      await compileTextBox({ text: 'Hello', h: 1 })
    );
    expect(content).toBe('Hello');
    expect(opts).toMatchObject({ fontSize: 18 });
  });

  it('maps derived sizing and line spacing', async () => {
    const [, auto] = emitCall(
      await compileTextBox({
        runs: [
          { text: 'one', breakLine: true },
          { text: 'two', breakLine: true },
          { text: 'three' },
        ],
        fontSize: 18,
      })
    );
    expect(auto.h).toBeCloseTo((18 / 72) * 1.6 * 3);
    expect(auto.isTextBox).toBe(true);

    const [, multiple] = emitCall(
      await compileTextBox({
        text: 'Hero',
        fontSize: 80,
        lineSpacing: 72,
        lineSpacingMultiple: 0.9,
      })
    );
    expect(multiple.lineSpacingMultiple).toBe(0.9);
    expect(multiple.lineSpacing).toBeUndefined();
  });
});
