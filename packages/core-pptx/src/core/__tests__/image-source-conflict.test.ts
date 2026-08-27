import { describe, it, expect } from 'vitest';
import {
  generateBufferFromJson,
  PresentationValidationError,
} from '../generator';

const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>';

const doc = (imgProps: Record<string, unknown>) => ({
  name: 'pptx' as const,
  props: { slideWidth: 10, slideHeight: 5.625 },
  children: [
    {
      name: 'slide',
      props: {},
      children: [
        { name: 'image', props: { x: 1, y: 1, w: 3, h: 3, ...imgProps } },
      ],
    },
  ],
});

describe('generateBufferFromJson — image source conflicts', () => {
  it('throws when an image sets more than one source', async () => {
    await expect(
      generateBufferFromJson(
        doc({ svg: SVG, path: 'https://example.com/x.png' }) as any
      )
    ).rejects.toMatchObject({
      name: PresentationValidationError.name,
      message: expect.stringMatching(/only one source/),
    });
  });

  it('reports content conflicts before preparation failures', async () => {
    const conflicted = {
      ...doc({ svg: SVG, path: 'https://example.com/x.png' }),
      props: null,
    };

    await expect(
      generateBufferFromJson(conflicted as any, {
        validation: { enabled: false },
      })
    ).rejects.toThrow(/Document validation failed/);
  });

  it('generates normally with a single (svg) source', async () => {
    const buf = await generateBufferFromJson(doc({ svg: SVG }) as any);
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBeGreaterThan(0);
  });
});
