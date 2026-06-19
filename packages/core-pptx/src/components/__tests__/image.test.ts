import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderImageComponent } from '../image';

function mockSlide() {
  return { addImage: vi.fn() } as any;
}

const theme = {} as any;

const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100" width="200" height="100"><rect width="200" height="100" fill="red"/></svg>';

describe('renderImageComponent — sources', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('wraps raw svg markup into an image/svg+xml data URI passed via data', async () => {
    const slide = mockSlide();
    await renderImageComponent(slide, { svg: SVG, w: 4, h: 2 }, theme);

    expect(slide.addImage).toHaveBeenCalledOnce();
    const opts = slide.addImage.mock.calls[0][0];
    const expected = `data:image/svg+xml;base64,${Buffer.from(SVG, 'utf-8').toString('base64')}`;
    expect(opts.data).toBe(expected);
    expect(opts.path).toBeUndefined();
  });

  it('prefers svg over base64 and path (precedence svg > base64 > path)', async () => {
    const slide = mockSlide();
    await renderImageComponent(
      slide,
      {
        svg: SVG,
        base64: 'data:image/png;base64,AAAA',
        path: 'https://example.com/x.png',
        w: 4,
        h: 2,
      },
      theme
    );

    const opts = slide.addImage.mock.calls[0][0];
    expect(opts.data).toBe(
      `data:image/svg+xml;base64,${Buffer.from(SVG, 'utf-8').toString('base64')}`
    );
  });

  it('routes base64 data URI through data', async () => {
    const slide = mockSlide();
    await renderImageComponent(
      slide,
      { base64: 'data:image/png;base64,AAAA', w: 4, h: 2 },
      theme
    );

    const opts = slide.addImage.mock.calls[0][0];
    expect(opts.data).toBe('data:image/png;base64,AAAA');
    expect(opts.path).toBeUndefined();
  });

  it('routes a file path/URL through path', async () => {
    const slide = mockSlide();
    await renderImageComponent(
      slide,
      { path: 'https://example.com/x.png', w: 4, h: 2 },
      theme
    );

    const opts = slide.addImage.mock.calls[0][0];
    expect(opts.path).toBe('https://example.com/x.png');
    expect(opts.data).toBeUndefined();
  });

  it('warns and skips when no source is provided', async () => {
    const slide = mockSlide();
    const warnings: any[] = [];
    await renderImageComponent(slide, { w: 4, h: 2 }, theme, warnings);

    expect(slide.addImage).not.toHaveBeenCalled();
    expect(warnings.length).toBeGreaterThan(0);
  });

  it('ignores a blank base64 and falls through to a valid path', async () => {
    const slide = mockSlide();
    await renderImageComponent(
      slide,
      { base64: '   ', path: 'https://example.com/x.png', w: 4, h: 2 },
      theme
    );

    const opts = slide.addImage.mock.calls[0][0];
    expect(opts.path).toBe('https://example.com/x.png');
    expect(opts.data).toBeUndefined();
  });

  it('warns and skips when all sources are blank', async () => {
    const slide = mockSlide();
    const warnings: any[] = [];
    await renderImageComponent(
      slide,
      { svg: '  ', base64: '', path: '   ', w: 4, h: 2 },
      theme,
      warnings
    );

    expect(slide.addImage).not.toHaveBeenCalled();
    expect(warnings.length).toBeGreaterThan(0);
  });

  it('auto-calculates missing height from the svg viewBox aspect ratio', async () => {
    const slide = mockSlide();
    // viewBox 200x100 → aspect 2; width 4in → height 2in
    await renderImageComponent(slide, { svg: SVG, w: 4 }, theme);

    const opts = slide.addImage.mock.calls[0][0];
    expect(opts.w).toBeCloseTo(4);
    expect(opts.h).toBeCloseTo(2);
  });
});
