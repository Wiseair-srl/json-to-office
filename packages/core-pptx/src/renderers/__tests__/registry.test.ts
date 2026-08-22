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
  });

  it('fails with an actionable message for an unknown renderer', async () => {
    await expect(resolvePptxRenderer('nope' as never)).rejects.toThrow(
      /Unknown pptx renderer "nope".*pptxgenjs.*office-open/s
    );
  });

  it('reports the missing optional backend when office-open is selected', async () => {
    // `@office-open/pptx` is not installed yet, so selecting it must say so
    // rather than failing with a bare module-resolution error.
    await expect(resolvePptxRenderer('office-open')).rejects.toThrow(
      /@office-open\/pptx/
    );
  });
});
