import { describe, expect, it } from 'vitest';

import { documentMetrics } from './metrics.js';

describe('documentMetrics', () => {
  it('counts a placeholder the renderer painted as a leak, like authored filler', () => {
    const metrics = documentMetrics({
      pages: 2,
      diagnostics: [
        {
          code: 'W_QUALITY_RENDERED_PLACEHOLDER',
          severity: 'warning',
          certainty: 'rendered',
          context: { mapping: 'mapped' },
        },
        { code: 'W_QUALITY_PLACEHOLDER_TEXT', severity: 'warning' },
        {
          code: 'W_QUALITY_RENDERED_TEXT_MISSING',
          severity: 'warning',
          certainty: 'rendered',
          context: { mapping: 'mapped' },
        },
      ],
    });
    expect(metrics.placeholderLeaks).toBe(2);
    expect(metrics.qualityByCode.W_QUALITY_RENDERED_PLACEHOLDER).toBe(1);
  });
});
