/**
 * Text compilation, ported from the deleted `components/__tests__/text-runs.test.ts`.
 *
 * Everything the old writer resolved while building its option bag — the run
 * cascade, weight aliasing, underline shorthand, page-number substitution, the
 * derived height, the missing-content warning — is compiler behaviour now, so
 * it is asserted on the IR. Only the two things that were genuinely about *how*
 * PptxGenJS is called (a lone run goes in as a string, several runs go in as a
 * `[{ text, options }]` array, and the block-level bag carries the body
 * defaults) are asserted against the adapter.
 */

import { describe, expect, it } from 'vitest';
import type PptxGenJS from 'pptxgenjs';
import { compileDocumentToIr } from '../../core/generateFromIr';
import { emitTextBox } from '../../renderers/pptxgenjs/emit';
import type {
  PptxThemeConfig,
  PresentationComponentDefinition,
} from '../../types';
import { EMU_PER_INCH } from '../types';
import type { PptxIR, PptxIrTextBoxElement } from '../types';
import { assertValidPptxIr } from '../validation';

/** The theme the original test used, inline so the document is self-contained. */
const THEME: PptxThemeConfig = {
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

function deck(
  children: unknown[],
  props: Record<string, unknown> = {}
): PresentationComponentDefinition {
  const merged: Record<string, unknown> = { theme: THEME, ...props };
  return {
    name: 'pptx',
    props: merged,
    children,
  } as PresentationComponentDefinition;
}

const slide = (
  children: unknown[],
  props: Record<string, unknown> = {}
): unknown => ({ name: 'slide', props, children });

const text = (props: Record<string, unknown>): unknown => ({
  name: 'text',
  props,
});

function compile(
  document: PresentationComponentDefinition,
  options?: Parameters<typeof compileDocumentToIr>[1]
) {
  const result = compileDocumentToIr(document, options);
  assertValidPptxIr(result.ir);
  return result;
}

/** The first text box of the first slide. */
function textBox(ir: PptxIR, slideIndex = 0): PptxIrTextBoxElement {
  return ir.slides[slideIndex].elements[0] as PptxIrTextBoxElement;
}

/** Compile a single text component and return its IR element. */
function compileTextBox(props: Record<string, unknown>): PptxIrTextBoxElement {
  return textBox(compile(deck([slide([text(props)])])).ir);
}

type Segment = { text: string; options: Record<string, unknown> };
type AddTextCall = [
  content: string | Segment[],
  options: Record<string, unknown>,
];

/** Run the adapter over one text box and capture the `addText` call it makes. */
function emitCall(element: PptxIrTextBoxElement): AddTextCall {
  const calls: AddTextCall[] = [];
  const slideStub = {
    addText: (content: unknown, options: unknown) => {
      calls.push([
        content as string | Segment[],
        options as Record<string, unknown>,
      ]);
    },
  } as unknown as PptxGenJS.Slide;

  emitTextBox(slideStub, element, {
    pptx: {} as PptxGenJS,
    resources: new Map(),
  });

  expect(calls).toHaveLength(1);
  return calls[0];
}

describe('text runs compile to IR runs', () => {
  it('resolves every run property, cascading what the run leaves unset', () => {
    const { ir, warnings } = compile(
      deck([
        slide([
          text({
            x: 1,
            y: 1,
            w: 4,
            h: 1,
            runs: [
              { text: '27', fontSize: 27, bold: true, color: 'primary' },
              {
                text: ' pts',
                fontSize: 18,
                italic: true,
                underline: true,
                breakLine: true,
              },
              {
                text: 'x2',
                superscript: true,
                subscript: false,
                strike: true,
                charSpacing: 1.5,
                fontFace: 'Georgia',
              },
            ],
          }),
        ]),
      ])
    );

    // Theme tokens are resolved here, not at the renderer: `primary` is already
    // hex, uppercased by the IR's colour normalisation.
    expect(textBox(ir).runs).toEqual([
      {
        text: '27',
        fontFamily: 'Arial',
        fontSize: 27,
        color: { hex: '0066CC' },
        bold: true,
        italic: false,
      },
      {
        text: ' pts',
        fontFamily: 'Arial',
        fontSize: 18,
        color: { hex: '000000' },
        italic: true,
        underline: { style: 'sng' },
        breakAfter: true,
      },
      {
        text: 'x2',
        fontFamily: 'Georgia',
        fontSize: 18,
        color: { hex: '000000' },
        strike: true,
        superscript: true,
        subscript: false,
        characterSpacing: 1.5,
      },
    ]);
    expect(warnings).toEqual([]);
  });

  it('keeps the component defaults on the body, not on the runs', () => {
    const element = compileTextBox({
      x: 1,
      y: 1,
      w: 4,
      h: 1,
      runs: [{ text: 'a' }, { text: 'b' }],
    });

    expect(element.style.defaults).toEqual({
      fontFamily: 'Arial',
      fontSize: 18,
      color: { hex: '000000' },
    });
    expect(element.transform).toEqual({
      xEmu: EMU_PER_INCH,
      yEmu: EMU_PER_INCH,
      widthEmu: 4 * EMU_PER_INCH,
      heightEmu: EMU_PER_INCH,
    });
  });

  it('runs inherit component-level bold/italic unless overridden', () => {
    const element = compileTextBox({
      runs: [{ text: 'a' }, { text: 'b', bold: false, italic: false }],
      bold: true,
      italic: true,
      h: 1,
    });

    expect(element.runs[0]).toMatchObject({ bold: true, italic: true });
    expect(element.runs[1]).toMatchObject({ bold: false, italic: false });
  });

  it('aliases an inherited font weight onto a synthesized family', () => {
    const element = compileTextBox({
      runs: [{ text: 'light' }, { text: 'heavy', fontWeight: 700 }],
      fontWeight: 300,
      h: 1,
    });

    expect(element.runs[0]).toMatchObject({
      fontFamily: 'Arial Light',
      bold: false,
    });
    // 700 is a real face, so it stays native bold rather than a name suffix.
    expect(element.runs[1]).toMatchObject({ fontFamily: 'Arial', bold: true });
  });

  it('does not re-alias a run that names its own font face', () => {
    const element = compileTextBox({
      runs: [{ text: 'own face', fontFace: 'Georgia Light' }],
      fontWeight: 300,
      h: 1,
    });

    expect(element.runs[0].fontFamily).toBe('Georgia Light');
  });

  it('resolves {PAGE_NUMBER} placeholders inside runs', () => {
    // The slide context is derived from the deck now: nine slides, the text on
    // the second, so the run reads "Page 2/9" exactly as before.
    const slides = Array.from({ length: 9 }, (_, index) =>
      index === 1
        ? slide([
            text({
              runs: [{ text: 'Page {PAGE_NUMBER}/{PAGE_COUNT}' }],
              h: 0.5,
            }),
          ])
        : slide([])
    );

    const { ir } = compile(deck(slides));

    expect(textBox(ir, 1).runs[0].text).toBe('Page 2/9');
  });

  it('pads page numbers when the deck asks for the 09 format', () => {
    // Twelve slides so the padding is observable: both numbers widen to two
    // digits, the width of the total.
    const slides = Array.from({ length: 12 }, (_, index) =>
      index === 1
        ? slide([
            text({ runs: [{ text: '{PAGE_NUMBER}/{PAGE_COUNT}' }], h: 0.5 }),
          ])
        : slide([])
    );

    const { ir } = compile(deck(slides, { pageNumberFormat: '09' }));

    expect(textBox(ir, 1).runs[0].text).toBe('02/12');
  });

  it('derives the default height from run line breaks', () => {
    const element = compileTextBox({
      runs: [
        { text: 'line 1', breakLine: true },
        { text: 'line 2', breakLine: true },
        { text: 'line 3' },
      ],
      fontSize: 18,
    });

    expect(element.transform.heightEmu).toBe(
      Math.round((18 / 72) * 1.6 * 3 * EMU_PER_INCH)
    );
    // `autoFit` is what the adapter turns into `isTextBox`.
    expect(element.style.autoFit).toBe(true);
  });

  it('warns and skips when neither text nor runs carries content', () => {
    // An empty `runs` array is the shape that still reaches the compiler's own
    // guard: it satisfies the structural "one of text/runs" check but has
    // nothing to render. Validation is off because the component schema also
    // rejects it, and the guard being tested lives past that.
    const { ir, warnings } = compile(deck([slide([text({ runs: [] })])]), {
      validation: { enabled: false },
    });

    expect(ir.slides[0].elements).toEqual([]);
    expect(warnings.map((w) => w.code)).toEqual(['TEXT_NO_CONTENT']);
  });

  it('rejects a text component with neither text nor runs before compiling', () => {
    // The original test drove the writer with `{}` directly. On the public
    // entry point that shape now dies earlier — the structural content check
    // runs even with validation disabled — so it never reaches the compiler.
    expect(() =>
      compile(deck([slide([text({})])]), { validation: { enabled: false } })
    ).toThrow(/Text component requires content/);
  });

  it('compiles plain text into a single fully-resolved run', () => {
    const element = compileTextBox({ text: 'Hello', h: 1 });

    expect(element.runs).toEqual([
      {
        text: 'Hello',
        fontFamily: 'Arial',
        fontSize: 18,
        color: { hex: '000000' },
      },
    ]);
  });
});

describe('text line spacing compiles to IR body style', () => {
  it('keeps lineSpacingMultiple and drops point lineSpacing', () => {
    const element = compileTextBox({
      text: 'Hero',
      fontSize: 80,
      lineSpacing: 72,
      lineSpacingMultiple: 0.9,
    });

    expect(element.style.lineSpacingMultiple).toBe(0.9);
    expect(element.style.lineSpacingPoints).toBeUndefined();
  });

  it('keeps point lineSpacing when no multiple is given', () => {
    const element = compileTextBox({
      text: 'Hero',
      fontSize: 20,
      lineSpacing: 24,
    });

    expect(element.style.lineSpacingPoints).toBe(24);
    expect(element.style.lineSpacingMultiple).toBeUndefined();
  });
});

describe('text IR emits PptxGenJS calls', () => {
  it('maps runs to pptxgenjs [{ text, options }] arrays', () => {
    const element = compileTextBox({
      x: 1,
      y: 1,
      w: 4,
      h: 1,
      runs: [
        { text: '27', fontSize: 27, bold: true, color: 'primary' },
        {
          text: ' pts',
          fontSize: 18,
          italic: true,
          underline: true,
          breakLine: true,
        },
        {
          text: 'x2',
          superscript: true,
          subscript: false,
          strike: true,
          charSpacing: 1.5,
          fontFace: 'Georgia',
        },
      ],
    });

    const [content, opts] = emitCall(element);

    // Colours arrive uppercased — that is the IR's normalisation, and the
    // bytes are unchanged because PptxGenJS uppercases hex itself.
    expect(content).toEqual([
      {
        text: '27',
        options: {
          fontFace: 'Arial',
          fontSize: 27,
          color: '0066CC',
          bold: true,
          italic: false,
        },
      },
      {
        text: ' pts',
        options: {
          fontFace: 'Arial',
          fontSize: 18,
          color: '000000',
          italic: true,
          underline: { style: 'sng' },
          breakLine: true,
        },
      },
      {
        text: 'x2',
        options: {
          fontFace: 'Georgia',
          fontSize: 18,
          color: '000000',
          strike: true,
          superscript: true,
          subscript: false,
          charSpacing: 1.5,
        },
      },
    ]);
    // Component-level defaults stay at the block level — and they come from the
    // body defaults, never from whichever run happens to be first, so the first
    // run's bold must not leak here.
    expect(opts).toEqual({
      x: 1,
      y: 1,
      w: 4,
      h: 1,
      fontFace: 'Arial',
      fontSize: 18,
      color: '000000',
      valign: 'top',
      margin: 0,
    });
  });

  it('still passes plain text as a string', () => {
    const [content, opts] = emitCall(compileTextBox({ text: 'Hello', h: 1 }));

    expect(content).toBe('Hello');
    expect(opts).toMatchObject({ fontSize: 18 });
  });

  it('marks a box with a derived height as a text box', () => {
    const [, opts] = emitCall(
      compileTextBox({
        runs: [
          { text: 'line 1', breakLine: true },
          { text: 'line 2', breakLine: true },
          { text: 'line 3' },
        ],
        fontSize: 18,
      })
    );

    expect(opts.h).toBeCloseTo((18 / 72) * 1.6 * 3);
    expect(opts.isTextBox).toBe(true);
  });

  it('passes lineSpacingMultiple through and drops point lineSpacing', () => {
    const [, opts] = emitCall(
      compileTextBox({
        text: 'Hero',
        fontSize: 80,
        lineSpacing: 72,
        lineSpacingMultiple: 0.9,
      })
    );

    expect(opts.lineSpacingMultiple).toBe(0.9);
    expect(opts.lineSpacing).toBeUndefined();
  });

  it('keeps point lineSpacing when no multiple is given', () => {
    const [, opts] = emitCall(
      compileTextBox({ text: 'Hero', fontSize: 20, lineSpacing: 24 })
    );

    expect(opts.lineSpacing).toBe(24);
    expect(opts.lineSpacingMultiple).toBeUndefined();
  });
});
