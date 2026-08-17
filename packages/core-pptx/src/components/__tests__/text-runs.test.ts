import { describe, it, expect, vi } from 'vitest';
import { renderTextComponent } from '../text';
import type { PipelineWarning } from '../../types';

function mockSlide() {
  return { addText: vi.fn() } as any;
}

const theme = {
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
} as any;

describe('renderTextComponent rich text runs', () => {
  it('maps runs to pptxgenjs [{ text, options }] arrays', () => {
    const slide = mockSlide();
    const warnings: PipelineWarning[] = [];
    renderTextComponent(
      slide,
      {
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
        x: 1,
        y: 1,
        w: 4,
        h: 1,
      },
      theme,
      warnings
    );

    expect(slide.addText).toHaveBeenCalledTimes(1);
    const [runs, opts] = slide.addText.mock.calls[0];
    expect(runs).toEqual([
      {
        text: '27',
        options: expect.objectContaining({
          fontSize: 27,
          bold: true,
          color: '0066cc',
        }),
      },
      {
        text: ' pts',
        options: expect.objectContaining({
          fontSize: 18,
          italic: true,
          underline: { style: 'sng' },
          breakLine: true,
        }),
      },
      {
        text: 'x2',
        options: expect.objectContaining({
          superscript: true,
          subscript: false,
          strike: true,
          charSpacing: 1.5,
          fontFace: 'Georgia',
        }),
      },
    ]);
    // Component-level defaults stay at the block level.
    expect(opts).toMatchObject({ x: 1, y: 1, w: 4, h: 1, fontSize: 18 });
    expect(warnings).toEqual([]);
  });

  it('runs inherit component-level bold/italic unless overridden', () => {
    const slide = mockSlide();
    renderTextComponent(
      slide,
      {
        runs: [{ text: 'a' }, { text: 'b', bold: false, italic: false }],
        bold: true,
        italic: true,
        h: 1,
      },
      theme
    );

    const [runs] = slide.addText.mock.calls[0];
    expect(runs[0].options).toMatchObject({ bold: true, italic: true });
    expect(runs[1].options).toMatchObject({ bold: false, italic: false });
  });

  it('resolves {PAGE_NUMBER} placeholders inside runs', () => {
    const slide = mockSlide();
    renderTextComponent(
      slide,
      { runs: [{ text: 'Page {PAGE_NUMBER}/{PAGE_COUNT}' }], h: 0.5 },
      theme,
      undefined,
      { slideNumber: 2, totalSlides: 9, pageNumberFormat: '9' }
    );

    const [runs] = slide.addText.mock.calls[0];
    expect(runs[0].text).toBe('Page 2/9');
  });

  it('derives the default height from run line breaks', () => {
    const slide = mockSlide();
    renderTextComponent(
      slide,
      {
        runs: [
          { text: 'line 1', breakLine: true },
          { text: 'line 2', breakLine: true },
          { text: 'line 3' },
        ],
        fontSize: 18,
      },
      theme
    );

    const [, opts] = slide.addText.mock.calls[0];
    expect(opts.h).toBeCloseTo((18 / 72) * 1.6 * 3);
    expect(opts.isTextBox).toBe(true);
  });

  it('warns and skips when neither text nor runs is set', () => {
    const slide = mockSlide();
    const warnings: PipelineWarning[] = [];
    renderTextComponent(slide, {} as any, theme, warnings);

    expect(slide.addText).not.toHaveBeenCalled();
    expect(warnings).toHaveLength(1);
    expect(warnings[0].code).toBe('TEXT_NO_CONTENT');
  });

  it('still renders plain text unchanged', () => {
    const slide = mockSlide();
    renderTextComponent(slide, { text: 'Hello', h: 1 }, theme);

    expect(slide.addText).toHaveBeenCalledWith(
      'Hello',
      expect.objectContaining({ fontSize: 18 })
    );
  });
});

describe('renderTextComponent line spacing', () => {
  it('passes lineSpacingMultiple through and drops point lineSpacing', () => {
    const slide = mockSlide();
    renderTextComponent(
      slide,
      { text: 'Hero', fontSize: 80, lineSpacing: 72, lineSpacingMultiple: 0.9 },
      theme,
      {} as any,
      []
    );
    const [, opts] = slide.addText.mock.calls[0];
    expect(opts.lineSpacingMultiple).toBe(0.9);
    expect(opts.lineSpacing).toBeUndefined();
  });

  it('keeps point lineSpacing when no multiple is given', () => {
    const slide = mockSlide();
    renderTextComponent(
      slide,
      { text: 'Hero', fontSize: 20, lineSpacing: 24 },
      theme,
      {} as any,
      []
    );
    const [, opts] = slide.addText.mock.calls[0];
    expect(opts.lineSpacing).toBe(24);
    expect(opts.lineSpacingMultiple).toBeUndefined();
  });
});
