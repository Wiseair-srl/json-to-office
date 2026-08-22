import { describe, expect, it } from 'vitest';
import { resolveGenerationRenderer } from '../../hooks/usePresentationGenerator';

describe('generation renderer provenance', () => {
  it('captures the selected renderer at request time', () => {
    let selected: string | undefined = 'office-open';
    const captured = resolveGenerationRenderer(undefined, selected);

    selected = 'pptxgenjs';

    expect(captured).toBe('office-open');
    expect(selected).toBe('pptxgenjs');
  });

  it('lets an explicit per-call renderer win', () => {
    expect(resolveGenerationRenderer('pptxgenjs', 'office-open')).toBe(
      'pptxgenjs'
    );
  });

  it('preserves an omitted renderer as the format default', () => {
    expect(resolveGenerationRenderer(undefined, undefined)).toBeUndefined();
  });
});
