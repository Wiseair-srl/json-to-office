/**
 * The size policy, pinned as arithmetic.
 *
 * The scenario these numbers exist for is concrete: forty pages at 300 DPI is
 * tens of megabytes of PNG, and no client should ever be handed that in a tool
 * result. The estimate has to refuse it before rendering, and the measurement
 * has to refuse it again if the estimate was wrong in the other direction.
 */

import { describe, it, expect } from 'vitest';

import { chooseDelivery } from '../tools/preview.js';
import {
  MAX_INLINE_IMAGE_BYTES,
  MAX_INLINE_IMAGE_PAGES,
  MAX_TOTAL_INLINE_BYTES,
  PREVIEW_DEFAULT_DPI,
  budgetSuggestion,
  describeBudget,
  estimatePageBytes,
  estimatedInlineBudget,
  measuredInlineBudget,
} from '../preview/limits.js';

describe('estimatePageBytes', () => {
  it('grows with the pixel count, not the DPI', () => {
    const at150 = estimatePageBytes(150);
    const at300 = estimatePageBytes(300);
    expect(at300 / at150).toBeCloseTo(4, 1);
  });

  it('stays in the same order of magnitude as a real render', () => {
    // A measured text page is ~180KB at 150 DPI and ~400KB at 300; the
    // estimate is deliberately pessimistic but must not be absurd.
    expect(estimatePageBytes(150)).toBeGreaterThan(180 * 1024);
    expect(estimatePageBytes(150)).toBeLessThan(4 * 1024 * 1024);
  });
});

describe('estimatedInlineBudget', () => {
  it('lets a small preview through', () => {
    const budget = estimatedInlineBudget(3, PREVIEW_DEFAULT_DPI);
    expect(budget.fits).toBe(true);
    expect(budget.exceeded).toEqual([]);
    expect(budget.estimated).toBe(true);
  });

  it('refuses 40 pages at 300 DPI on both count and bytes', () => {
    const budget = estimatedInlineBudget(40, 300);
    expect(budget.fits).toBe(false);
    expect(budget.exceeded).toContain('pageCount');
    expect(budget.exceeded).toContain('totalBytes');
    expect(budget.bytes).toBeGreaterThan(MAX_TOTAL_INLINE_BYTES);
  });

  it('refuses a page count over the image limit even when tiny', () => {
    const budget = estimatedInlineBudget(MAX_INLINE_IMAGE_PAGES + 1, 36);
    expect(budget.fits).toBe(false);
    expect(budget.exceeded).toEqual(['pageCount']);
  });

  it('refuses one page that is too big on its own', () => {
    const budget = estimatedInlineBudget(1, 600);
    expect(estimatePageBytes(600)).toBeGreaterThan(MAX_INLINE_IMAGE_BYTES);
    expect(budget.fits).toBe(false);
    expect(budget.exceeded).toContain('imageBytes');
  });
});

describe('measuredInlineBudget', () => {
  it('accepts real bytes under every ceiling', () => {
    const budget = measuredInlineBudget([100_000, 120_000, 90_000]);
    expect(budget.fits).toBe(true);
    expect(budget.bytes).toBe(310_000);
    expect(budget.estimated).toBe(false);
  });

  it('catches a total the estimate let through', () => {
    const budget = measuredInlineBudget(Array(8).fill(1_500_000));
    expect(budget.fits).toBe(false);
    expect(budget.exceeded).toContain('totalBytes');
  });

  it('catches a single oversized page', () => {
    const budget = measuredInlineBudget([MAX_INLINE_IMAGE_BYTES + 1]);
    expect(budget.fits).toBe(false);
    expect(budget.exceeded).toEqual(['imageBytes']);
  });
});

describe('the refusal an agent reads', () => {
  it('names every ceiling it broke, with numbers', () => {
    const text = describeBudget(estimatedInlineBudget(40, 300));
    expect(text).toContain('40 page');
    expect(text).toContain('10-image limit');
    expect(text).toContain('MB');
  });

  it('offers a page count that would actually fit', () => {
    const suggestion = budgetSuggestion(300);
    expect(suggestion).toContain('outputMode "path"');
    const affordable = Number(/at most (\d+) page/.exec(suggestion)?.[1]);
    expect(affordable).toBeGreaterThan(0);
    expect(estimatedInlineBudget(affordable, 300).fits).toBe(true);
  });
});

describe('chooseDelivery', () => {
  const fits = measuredInlineBudget([100_000]);
  const busts = measuredInlineBudget(Array(20).fill(1_000_000));

  it('always writes files when the caller asked for paths', () => {
    for (const budget of [fits, busts]) {
      expect(chooseDelivery('path', budget)).toEqual({
        inline: false,
        refuse: false,
        fellBack: false,
      });
    }
  });

  it('inlines what fits, in either permissive mode', () => {
    for (const mode of ['auto', 'images'] as const) {
      expect(chooseDelivery(mode, fits)).toMatchObject({
        inline: true,
        refuse: false,
      });
    }
  });

  it('refuses rather than falling back when the caller demanded images', () => {
    expect(chooseDelivery('images', busts)).toEqual({
      inline: false,
      refuse: true,
      fellBack: false,
    });
  });

  it('falls back to files rather than refusing in auto', () => {
    // The rule the whole size policy exists for: an agent that asked to see
    // forty pages still gets the forty pages, just not in its context window.
    expect(chooseDelivery('auto', busts)).toEqual({
      inline: false,
      refuse: false,
      fellBack: true,
    });
  });
});
