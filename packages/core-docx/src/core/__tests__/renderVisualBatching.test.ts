/**
 * End-to-end guard for #153: rendering a document with several visuals must
 * coalesce rasterization into batch calls (one per document, not one per
 * visual), while per-visual rendering remains the fallback.
 */
import { describe, it, expect, vi } from 'vitest';
import { Document } from 'docx';
import { generateDocumentFromJson } from '../generator';

// A real (decodable) 1×1 PNG so createImage can measure it.
const VALID_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

const visual = (text: string) => ({
  name: 'visual',
  props: {
    canvas: { width: 4, height: 2 },
    elements: [{ name: 'text', props: { text, x: 1, y: 1, w: 2, h: 0.5 } }],
  },
});

const doc = () => ({
  name: 'docx',
  props: { title: 'Batching' },
  children: [
    { name: 'paragraph', props: { text: 'intro' } },
    visual('one'),
    visual('two'),
    visual('one'), // duplicate — must not rasterize twice
  ],
});

describe('renderDocument visual batching (#153)', () => {
  it('rasterizes all visuals in one renderBatch call instead of per visual', async () => {
    const renderBatch = vi.fn(async (req: any) => ({
      results: req.slides.map(() => ({
        ok: true,
        base64DataUri: VALID_PNG,
        width: 1,
        height: 1,
      })),
    }));
    const render = vi.fn();

    const document = await generateDocumentFromJson(doc() as any, {
      validation: { enabled: false },
      services: { pptx: { render, renderBatch } },
    });

    expect(document).toBeInstanceOf(Document);
    expect(renderBatch).toHaveBeenCalledOnce();
    expect(renderBatch.mock.calls[0][0].slides).toHaveLength(2); // deduped
    expect(render).not.toHaveBeenCalled();
  });

  it('still renders per visual when only a single rasterizer is configured', async () => {
    const render = vi.fn(async () => ({
      base64DataUri: VALID_PNG,
      width: 1,
      height: 1,
    }));

    const document = await generateDocumentFromJson(doc() as any, {
      validation: { enabled: false },
      services: { pptx: { render } },
    });

    expect(document).toBeInstanceOf(Document);
    // The pre-pass parallelizes but still dedupes: 2 unique visuals.
    expect(render).toHaveBeenCalledTimes(2);
  });

  it('fails the render with the recorded error when a visual cannot rasterize', async () => {
    const renderBatch = vi.fn(async (req: any) => ({
      results: req.slides.map((slide: any, i: number) =>
        i === 0
          ? { ok: true, base64DataUri: VALID_PNG, width: 1, height: 1 }
          : { ok: false, error: 'slide exploded' }
      ),
    }));

    await expect(
      generateDocumentFromJson(doc() as any, {
        validation: { enabled: false },
        services: { pptx: { renderBatch } },
      })
    ).rejects.toThrow('slide exploded');
  });
});
