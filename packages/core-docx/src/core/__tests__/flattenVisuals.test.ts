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

  const visualNode = (id: string) => ({
    name: 'visual',
    id,
    props: { canvas: { width: 4, height: 2 }, elements: [] },
  });

  it('flattens visuals nested in a table cell and column header', async () => {
    const rasterize = fakeRasterizer();
    const doc = {
      name: 'docx',
      props: {},
      children: [
        {
          name: 'section',
          props: {},
          children: [
            {
              name: 'table',
              props: {
                columns: [
                  {
                    header: { content: visualNode('h1') },
                    cells: [
                      { content: visualNode('c1') },
                      { content: 'plain' },
                    ],
                  },
                ],
              },
            },
          ],
        },
      ],
    };
    const out: any = await flattenVisuals(doc, { rasterize });
    const col = out.children[0].children[0].props.columns[0];
    expect(col.header.content.name).toBe('image');
    expect(col.header.content.id).toBe('h1');
    expect(col.cells[0].content.name).toBe('image');
    expect(col.cells[1].content).toBe('plain');
    expect(rasterize).toHaveBeenCalledTimes(2);
  });

  it('flattens visuals in a section header/footer', async () => {
    const rasterize = fakeRasterizer();
    const doc = {
      name: 'docx',
      props: {},
      children: [
        {
          name: 'section',
          props: {
            header: [visualNode('hdr')],
            footer: [{ name: 'paragraph', props: { text: 'p' } }],
          },
          children: [],
        },
      ],
    };
    const out: any = await flattenVisuals(doc, { rasterize });
    expect(out.children[0].props.header[0].name).toBe('image');
    expect(out.children[0].props.header[0].id).toBe('hdr');
    expect(out.children[0].props.footer[0].name).toBe('paragraph');
    expect(rasterize).toHaveBeenCalledOnce();
  });

  it('does not rasterize a disabled visual (left as-is)', async () => {
    const rasterize = fakeRasterizer();
    const doc = {
      name: 'docx',
      props: {},
      children: [
        {
          name: 'section',
          props: {},
          children: [{ ...visualNode('d1'), enabled: false }],
        },
      ],
    };
    const out: any = await flattenVisuals(doc, { rasterize });
    expect(out.children[0].children[0].name).toBe('visual');
    expect(rasterize).not.toHaveBeenCalled();
  });

  describe('rasterizeBatch (#153)', () => {
    it('rasterizes every visual through one batch call; the single rasterizer stays idle', async () => {
      const rasterize = fakeRasterizer();
      const rasterizeBatch = vi.fn(async (req: any) => ({
        results: req.slides.map(() => ({
          ok: true,
          base64DataUri: PNG,
          width: 960,
          height: 640,
        })),
      }));
      const doc = {
        name: 'docx',
        props: {},
        children: [
          {
            name: 'section',
            props: { header: [visualNode('hdr')] },
            children: [visualNode('a'), visualNode('b')],
          },
        ],
      };

      const out: any = await flattenVisuals(doc, { rasterize, rasterizeBatch });

      expect(rasterizeBatch).toHaveBeenCalledOnce();
      // All three visuals share identical props (`id` is not part of the
      // rasterization identity), so they dedupe into a single slide.
      expect(rasterizeBatch.mock.calls[0][0].slides).toHaveLength(1);
      expect(rasterize).not.toHaveBeenCalled();
      expect(out.children[0].children.map((c: any) => c.name)).toEqual([
        'image',
        'image',
      ]);
      expect(out.children[0].props.header[0].name).toBe('image');
      expect(out.children[0].children[0].props.base64).toBe(PNG);
    });

    it('surfaces a per-slide batch error when that visual is flattened', async () => {
      const rasterize = fakeRasterizer();
      const rasterizeBatch = vi.fn(async () => ({
        results: [{ ok: false, error: 'poisoned slide' }],
      }));
      const doc = {
        name: 'docx',
        props: {},
        children: [
          { name: 'section', props: {}, children: [visualNode('bad')] },
        ],
      };

      await expect(
        flattenVisuals(doc, { rasterize, rasterizeBatch })
      ).rejects.toThrow('poisoned slide');
      expect(rasterize).not.toHaveBeenCalled();
    });
  });

  it('clamps an out-of-range dpi before calling the rasterizer', async () => {
    const rasterize = fakeRasterizer();
    const doc = {
      name: 'docx',
      props: {},
      children: [
        {
          name: 'section',
          props: {},
          children: [
            {
              name: 'visual',
              props: {
                canvas: { width: 4, height: 2 },
                elements: [],
                dpi: 5000,
              },
            },
          ],
        },
      ],
    };
    await flattenVisuals(doc, { rasterize });
    expect(rasterize.mock.calls[0][0].dpi).toBe(600); // MAX_VISUAL_DPI
  });
});
