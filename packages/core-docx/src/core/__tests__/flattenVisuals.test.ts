import { describe, it, expect, vi } from 'vitest';
import { flattenVisuals } from '../flattenVisuals';

const PNG = 'data:image/png;base64,AAAA';

function fakeRasterizer() {
  return vi
    .fn()
    .mockResolvedValue({ base64DataUri: PNG, width: 960, height: 640 });
}

const docWithVisual = () => ({
  name: 'docx',
  props: { title: 'T' },
  children: [
    {
      name: 'section',
      props: {},
      children: [
        { name: 'paragraph', props: { text: 'before' } },
        {
          name: 'visual',
          id: 'v1',
          props: {
            canvas: { width: 6, height: 3, theme: 'mono' },
            elements: [{ name: 'text', props: { text: 'Hi' } }],
            caption: 'Fig 1',
            alignment: 'center',
            dpi: 150,
          },
        },
        { name: 'paragraph', props: { text: 'after' } },
      ],
    },
  ],
});

describe('flattenVisuals', () => {
  it('replaces a visual node with an image node carrying the base64 PNG', async () => {
    const rasterize = fakeRasterizer();
    const out: any = await flattenVisuals(docWithVisual(), { rasterize });

    const children = out.children[0].children;
    expect(children.map((c: any) => c.name)).toEqual([
      'paragraph',
      'image',
      'paragraph',
    ]);

    const image = children[1];
    expect(image).toMatchObject({
      name: 'image',
      id: 'v1', // identity preserved
      props: {
        base64: PNG,
        width: 576, // 6in * 96
        alignment: 'center',
        caption: 'Fig 1',
      },
    });
    // the pptx canvas/elements must not leak into the image props
    expect(image.props).not.toHaveProperty('canvas');
    expect(image.props).not.toHaveProperty('elements');
  });

  it('forwards a single-slide pptx presentation + resolved dpi to the rasterizer', async () => {
    const rasterize = fakeRasterizer();
    await flattenVisuals(docWithVisual(), { rasterize, dpi: 200 });

    expect(rasterize).toHaveBeenCalledOnce();
    const arg = rasterize.mock.calls[0][0];
    expect(arg.dpi).toBe(150); // per-visual dpi wins over the option default
    expect(arg.presentation).toMatchObject({
      name: 'pptx',
      props: { slideWidth: 6, slideHeight: 3, theme: 'mono' },
      children: [{ name: 'slide', children: [{ name: 'text' }] }],
    });
  });

  it('leaves documents without visuals untouched and does not rasterize', async () => {
    const rasterize = fakeRasterizer();
    const doc = {
      name: 'docx',
      props: {},
      children: [
        {
          name: 'section',
          props: {},
          children: [{ name: 'paragraph', props: { text: 'x' } }],
        },
      ],
    };
    const out = await flattenVisuals(doc, { rasterize });
    expect(out).toEqual(doc);
    expect(rasterize).not.toHaveBeenCalled();
  });
});
