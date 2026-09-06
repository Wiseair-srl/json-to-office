import { describe, expect, it } from 'vitest';
import {
  isPptxRendererId,
  pptxRendererIds,
  resolvePptxRenderer,
} from '../registry';
import { DEFAULT_PPTX_RENDERER_ID } from '../types';

describe('PPTX renderer registry', () => {
  it('registers both renderer ids', () => {
    expect(pptxRendererIds()).toEqual(['pptxgenjs', 'office-open']);
  });

  it('defaults to pptxgenjs', async () => {
    expect(DEFAULT_PPTX_RENDERER_ID).toBe('pptxgenjs');
    const renderer = await resolvePptxRenderer();
    expect(renderer.id).toBe('pptxgenjs');
    expect(renderer.format).toBe('pptx');
  });

  it('recognises valid ids and rejects others', () => {
    expect(isPptxRendererId('pptxgenjs')).toBe(true);
    expect(isPptxRendererId('office-open')).toBe(true);
    expect(isPptxRendererId('docxjs')).toBe(false);
  });

  it('lists the pptxgenjs capabilities and its real gaps', async () => {
    const { capabilities } = await resolvePptxRenderer('pptxgenjs');

    expect(capabilities.has('text')).toBe(true);
    expect(capabilities.has('rich-text')).toBe(true);
    expect(capabilities.has('shapes')).toBe(true);
    expect(capabilities.has('images')).toBe(true);
    expect(capabilities.has('gradient-fills')).toBe(true);
    expect(capabilities.has('pattern-fills')).toBe(true);

    // Genuine gaps, not omissions — PptxGenJS has no API for any of these.
    expect(capabilities.has('image-fills')).toBe(false);
    expect(capabilities.has('transitions')).toBe(false);
    expect(capabilities.has('groups')).toBe(false);
    expect(capabilities.has('complex-bullet-glyphs')).toBe(false);
  });

  it('fails with an actionable message for an unknown renderer', async () => {
    await expect(resolvePptxRenderer('nope' as never)).rejects.toThrow(
      /Unknown pptx renderer "nope".*pptxgenjs.*office-open/s
    );
  });

  it('resolves the office-open renderer with a narrower capability set', async () => {
    const officeOpen = await resolvePptxRenderer('office-open');
    const pptxgenjs = await resolvePptxRenderer('pptxgenjs');

    expect(officeOpen.id).toBe('office-open');
    expect(officeOpen.format).toBe('pptx');

    // Each backend has abilities the other lacks; neither is a subset.
    expect(officeOpen.capabilities.has('transitions')).toBe(true);
    expect(officeOpen.capabilities.has('groups')).toBe(true);
    expect(officeOpen.capabilities.has('complex-bullet-glyphs')).toBe(true);
    expect(pptxgenjs.capabilities.has('transitions')).toBe(false);

    // `charts` was a declared gap and is one no longer: the adapter writes the
    // workbook the backend omits, so the chart it draws is editable.
    expect(officeOpen.capabilities.has('charts')).toBe(true);

    // Verified gaps in office-open, declared as gaps rather than mapped badly.
    for (const feature of [
      'svg',
      'image-transform',
      'flip-vertical',
      'element-hyperlinks',
      'table-merged-cells',
    ] as const) {
      expect({
        feature,
        supported: officeOpen.capabilities.has(feature),
      }).toEqual({ feature, supported: false });
      expect({
        feature,
        supported: pptxgenjs.capabilities.has(feature),
      }).toEqual({ feature, supported: true });
    }
  });
});
