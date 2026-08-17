import { describe, it, expect, vi } from 'vitest';
import { renderShapeComponent } from '../shape';
import type { PendingXmlFill, PipelineWarning } from '../../types';

function mockSlide() {
  return { addShape: vi.fn(), addText: vi.fn() } as any;
}

const mockPptx = {
  ShapeType: {
    rect: 'rect',
    ellipse: 'ellipse',
    arc: 'arc',
    pie: 'pie',
    blockArc: 'blockArc',
    chord: 'chord',
  },
} as any;

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

function shapeOpts(
  props: Record<string, unknown>,
  warnings?: PipelineWarning[],
  pendingFills?: PendingXmlFill[]
) {
  const slide = mockSlide();
  renderShapeComponent(
    slide,
    props as any,
    theme,
    mockPptx,
    warnings,
    pendingFills
      ? { slideWidth: 10, slideHeight: 7.5, pendingFills }
      : undefined
  );
  return slide.addShape.mock.calls[0]?.[1];
}

describe('renderShapeComponent gradient fill', () => {
  it('registers a pending gradient fill and renders a tagged sentinel', () => {
    const warnings: PipelineWarning[] = [];
    const pendingFills: PendingXmlFill[] = [];
    const opts = shapeOpts(
      {
        type: 'rect',
        fill: {
          gradient: {
            type: 'linear',
            angle: 45,
            stops: [
              { color: 'primary', pos: 0 },
              { color: 'FFFFFF', pos: 100, transparency: 30 },
            ],
          },
        },
      },
      warnings,
      pendingFills
    );

    expect(pendingFills).toHaveLength(1);
    expect(pendingFills[0].objectName).toBe('__jto_fill_0__');
    expect(pendingFills[0].xml).toBe(
      '<a:gradFill rotWithShape="1"><a:gsLst>' +
        '<a:gs pos="0"><a:srgbClr val="0066CC"></a:srgbClr></a:gs>' +
        '<a:gs pos="100000"><a:srgbClr val="FFFFFF"><a:alpha val="70000"/></a:srgbClr></a:gs>' +
        '</a:gsLst><a:lin ang="2700000" scaled="1"/></a:gradFill>'
    );
    expect(opts.objectName).toBe('__jto_fill_0__');
    // Sentinel solid fill: first stop color, so a failed splice stays visible.
    expect(opts.fill).toEqual({ color: '0066cc' });
    expect(warnings).toEqual([]);
  });

  it('builds radial gradients with a corner-focus fillToRect', () => {
    const pendingFills: PendingXmlFill[] = [];
    shapeOpts(
      {
        type: 'ellipse',
        fill: {
          gradient: {
            type: 'radial',
            focus: 'topLeft',
            stops: [
              { color: '112233', pos: 0 },
              { color: '445566', pos: 100 },
            ],
          },
        },
      },
      undefined,
      pendingFills
    );

    expect(pendingFills[0].xml).toContain(
      '<a:path path="circle"><a:fillToRect l="0" t="0" r="100000" b="100000"/></a:path>'
    );
    expect(pendingFills[0].xml).not.toContain('<a:lin');
  });

  it('warns and falls back to a solid fill without a pending-fill registry', () => {
    const warnings: PipelineWarning[] = [];
    const opts = shapeOpts(
      {
        type: 'rect',
        fill: {
          gradient: {
            type: 'linear',
            stops: [
              { color: 'primary', pos: 0 },
              { color: 'FFFFFF', pos: 100 },
            ],
          },
        },
      },
      warnings
    );

    expect(opts.objectName).toBeUndefined();
    expect(opts.fill).toEqual({ color: '0066cc' });
    expect(warnings).toHaveLength(1);
    expect(warnings[0].code).toBe('ADVANCED_FILL_FALLBACK');
  });
});

describe('renderShapeComponent pattern fill', () => {
  it('registers a pending pattern fill with resolved colors', () => {
    const warnings: PipelineWarning[] = [];
    const pendingFills: PendingXmlFill[] = [];
    const opts = shapeOpts(
      {
        type: 'rect',
        fill: {
          pattern: {
            preset: 'ltUpDiag',
            foreground: 'primary',
            background: 'FFFFFF',
          },
        },
      },
      warnings,
      pendingFills
    );

    expect(pendingFills).toHaveLength(1);
    expect(pendingFills[0].xml).toBe(
      '<a:pattFill prst="ltUpDiag"><a:fgClr><a:srgbClr val="0066CC"/></a:fgClr>' +
        '<a:bgClr><a:srgbClr val="FFFFFF"/></a:bgClr></a:pattFill>'
    );
    expect(opts.objectName).toBe('__jto_fill_0__');
    expect(opts.fill).toEqual({ color: '0066cc' });
    expect(warnings).toEqual([]);
  });

  it('warns and falls back to solid foreground on an unknown preset', () => {
    const warnings: PipelineWarning[] = [];
    const pendingFills: PendingXmlFill[] = [];
    const opts = shapeOpts(
      {
        type: 'rect',
        fill: {
          pattern: {
            preset: 'polkaDots',
            foreground: 'primary',
            background: 'FFFFFF',
          },
        },
      },
      warnings,
      pendingFills
    );

    expect(pendingFills).toHaveLength(0);
    expect(opts.objectName).toBeUndefined();
    expect(warnings.some((w) => w.code === 'UNKNOWN_PATTERN_PRESET')).toBe(
      true
    );
    // The warning promises the foreground; without this the shape silently
    // took the pptxgenjs default instead.
    expect(opts.fill).toEqual({ color: '0066cc' });
  });

  it('prefers an explicit fill.color over the foreground fallback', () => {
    const opts = shapeOpts({
      type: 'rect',
      fill: {
        color: 'accent',
        pattern: {
          preset: 'polkaDots',
          foreground: 'primary',
          background: 'FFFFFF',
        },
      },
    });

    expect(opts.fill).toEqual({ color: '17a2b8' });
  });

  it('numbers sentinel names sequentially across a generation', () => {
    const pendingFills: PendingXmlFill[] = [];
    const grad = {
      type: 'linear',
      stops: [
        { color: '112233', pos: 0 },
        { color: '445566', pos: 100 },
      ],
    };
    shapeOpts(
      { type: 'rect', fill: { gradient: grad } },
      undefined,
      pendingFills
    );
    shapeOpts(
      { type: 'rect', fill: { gradient: grad } },
      undefined,
      pendingFills
    );

    expect(pendingFills.map((f) => f.objectName)).toEqual([
      '__jto_fill_0__',
      '__jto_fill_1__',
    ]);
  });
});

describe('renderShapeComponent angleRange and flips', () => {
  it('passes angleRange, flipH, and flipV straight through', () => {
    const opts = shapeOpts({
      type: 'pie',
      angleRange: [-90, 180],
      flipH: true,
      flipV: true,
      fill: { color: 'accent' },
    });

    expect(opts).toMatchObject({
      angleRange: [-90, 180],
      flipH: true,
      flipV: true,
      fill: { color: '17a2b8' },
    });
  });

  it('renders arc-family shape types', () => {
    for (const type of ['arc', 'pie', 'blockArc', 'chord']) {
      const slide = mockSlide();
      renderShapeComponent(slide, { type } as any, theme, mockPptx);
      expect(slide.addShape).toHaveBeenCalledWith(type, expect.any(Object));
    }
  });

  it('leaves the passthrough opts unset when absent', () => {
    const opts = shapeOpts({ type: 'rect', fill: { color: 'primary' } });

    expect(opts.angleRange).toBeUndefined();
    expect(opts.flipH).toBeUndefined();
    expect(opts.flipV).toBeUndefined();
  });
});
