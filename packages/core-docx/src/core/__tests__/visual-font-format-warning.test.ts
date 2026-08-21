/**
 * A face the rasterizer's stagers cannot register is dropped, and the visual
 * then renders with a fallback. That is the exact silent substitution this
 * pipeline exists to make visible, so the drop has to reach the caller's
 * warnings — not just be inferable by reading the encoder.
 *
 * The sink existed but no caller passed it, so the message went nowhere.
 */
import { describe, it, expect, vi } from 'vitest';
import type { GenerationWarning } from '@json-to-office/shared';
import { generateBufferFromJson } from '../generator';

/** A 1x1 PNG, enough for the visual component to embed a rasterized result. */
const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const docWithVisual = (fontData: string) => ({
  name: 'docx',
  props: {
    theme: 'minimal',
    fontRegistry: [
      {
        id: 'brand',
        family: 'Brand Sans',
        sources: [{ kind: 'data', data: fontData, weight: 400 }],
      },
    ],
  },
  children: [
    // The registry only materializes families the document REFERENCES, so the
    // face has to actually be used for there to be anything to drop.
    {
      name: 'paragraph',
      props: { text: 'Body.', font: { family: 'Brand Sans' } },
    },
    {
      name: 'visual',
      props: {
        canvas: { width: 6, height: 4 },
        elements: [
          { name: 'text', props: { text: 'hi', x: 1, y: 1, w: 4, h: 1 } },
        ],
      },
    },
  ],
});

/** `wOFF` magic — a real format the stagers cannot register. */
const woff = () => {
  const b = Buffer.alloc(64, 7);
  b.write('wOFF', 0, 'ascii');
  return b.toString('base64');
};

async function warningsFor(doc: unknown): Promise<GenerationWarning[]> {
  const warnings: GenerationWarning[] = [];
  await generateBufferFromJson(doc as any, {
    warnings,
    services: {
      pptx: {
        render: vi.fn(async () => ({
          base64DataUri: `data:image/png;base64,${PNG}`,
          width: 40,
          height: 20,
        })),
      },
    },
  });
  return warnings;
}

const dropped = (w: GenerationWarning[]) =>
  w.filter((x) => x.context?.code === 'FONT_FORMAT_NOT_RASTERIZABLE');

describe('a face the rasterizer cannot stage is reported', () => {
  it('surfaces FONT_FORMAT_NOT_RASTERIZABLE from a real generation', async () => {
    const warnings = await warningsFor(docWithVisual(woff()));
    const hits = dropped(warnings);
    expect(hits).toHaveLength(1);
    expect(hits[0].message).toContain('Brand Sans');
    expect(hits[0].message).toContain('woff');
    expect(hits[0].component).toBe('fontRegistry');
  });

  it('stays silent for a face the stagers can register', async () => {
    // A real sfnt header, so the format sniffs as ttf and survives encoding.
    const ttf = Buffer.alloc(64);
    ttf.writeUInt32BE(0x00010000, 0);
    const warnings = await warningsFor(docWithVisual(ttf.toString('base64')));
    expect(dropped(warnings)).toEqual([]);
  });
});
