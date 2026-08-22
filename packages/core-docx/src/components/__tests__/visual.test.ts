/**
 * How a `visual` reaches the rasterizer, and what it becomes afterwards.
 *
 * A visual is a nested presentation that LibreOffice draws into a PNG, so
 * everything worth checking is on the way there: which service is called, at
 * what resolution, with which fonts, and whether the batch pre-pass is
 * consulted before any of it. What comes back is an ordinary image, and the
 * corpus covers images.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  buildVisualPresentation,
  visualRasterKey,
  visualToImageProps,
} from '../visual';
import { desugarExternals } from '../../core/desugarExternals';
import { compileDocumentToIr } from '../../core/generateFromIr';
import { createMockTheme } from './helpers';
import type { ReportComponentDefinition } from '../../types';

// Force a Node environment: rasterization refuses to run in a browser.
vi.mock('../../utils/environment', () => ({
  isNodeEnvironment: vi.fn().mockReturnValue(true),
  isBrowserEnvironment: vi.fn().mockReturnValue(false),
}));

const PNG_DATA_URI =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function visualProps(overrides: Record<string, unknown> = {}) {
  return {
    canvas: { width: 6, height: 4 },
    elements: [{ name: 'text', props: { text: 'Hi', x: 1, y: 1, w: 4, h: 1 } }],
    ...overrides,
  };
}

const visualComponent = (overrides: Record<string, unknown> = {}) => ({
  name: 'visual',
  props: visualProps(overrides),
});

/** Run the desugaring pass over a document holding one visual. */
async function desugar(
  component: Record<string, unknown>,
  options: Record<string, unknown> = {}
) {
  const document = {
    name: 'docx',
    props: {},
    children: [component],
  };
  return (await desugarExternals(document, {
    theme: createMockTheme(),
    ...options,
  })) as { children: Array<{ name: string; props: Record<string, unknown> }> };
}

describe('components/visual', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        base64DataUri: PNG_DATA_URI,
        width: 1200,
        height: 800,
      }),
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('rasterizes via an in-process render callback and desugars to an image', async () => {
    const render = vi.fn().mockResolvedValue({
      base64DataUri: PNG_DATA_URI,
      width: 1200,
      height: 800,
    });

    const result = await desugar(visualComponent(), {
      services: { pptx: { render } },
    });

    expect(render).toHaveBeenCalledOnce();
    expect(mockFetch).not.toHaveBeenCalled();
    expect(result.children[0].name).toBe('image');
    expect(result.children[0].props).toEqual(
      expect.objectContaining({
        base64: PNG_DATA_URI,
        // A 6in canvas draws 6in wide: 6 × 96px.
        width: 576,
        alignment: 'center',
      })
    );
  });

  it('builds a single-slide pptx presentation from canvas + elements', async () => {
    const render = vi.fn().mockResolvedValue({
      base64DataUri: PNG_DATA_URI,
      width: 10,
      height: 10,
    });

    await desugar(
      visualComponent({
        canvas: {
          width: 7.5,
          height: 10,
          theme: 'mono',
          background: { color: '#EEE' },
        },
      }),
      { services: { pptx: { render } } }
    );

    const { presentation } = render.mock.calls[0][0];
    expect(presentation).toMatchObject({
      name: 'pptx',
      props: { slideWidth: 7.5, slideHeight: 10, theme: 'mono' },
      children: [
        {
          name: 'slide',
          props: { background: { color: '#EEE' } },
          children: [{ name: 'text' }],
        },
      ],
    });
  });

  it('resolves dpi precedence: props > services > default(200)', async () => {
    const render = vi
      .fn()
      .mockResolvedValue({ base64DataUri: PNG_DATA_URI, width: 1, height: 1 });

    await desugar(visualComponent(), { services: { pptx: { render } } });
    expect(render.mock.calls[0][0].dpi).toBe(200);

    render.mockClear();
    await desugar(visualComponent(), {
      services: { pptx: { render, dpi: 144 } },
    });
    expect(render.mock.calls[0][0].dpi).toBe(144);

    render.mockClear();
    await desugar(visualComponent({ dpi: 300 }), {
      services: { pptx: { render, dpi: 144 } },
    });
    expect(render.mock.calls[0][0].dpi).toBe(300);
  });

  it('POSTs to {serverUrl}/rasterize and parses the JSON result', async () => {
    const result = await desugar(visualComponent(), {
      services: { pptx: { serverUrl: 'http://localhost:9000' } },
    });

    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:9000/rasterize',
      expect.objectContaining({ method: 'POST' })
    );
    expect(result.children[0].props).toEqual(
      expect.objectContaining({ base64: PNG_DATA_URI, width: 576 })
    );
  });

  it('prefers per-component serverUrl over services config', async () => {
    await desugar(visualComponent({ serverUrl: 'http://prop-server:1234' }), {
      services: { pptx: { serverUrl: 'http://services:5555' } },
    });

    expect(mockFetch).toHaveBeenCalledWith(
      'http://prop-server:1234/rasterize',
      expect.any(Object)
    );
  });

  it('leaves a component that is not a visual alone', async () => {
    const result = await desugar({
      name: 'paragraph',
      props: { text: 'x' },
    });

    expect(result.children[0].name).toBe('paragraph');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('leaves a disabled visual unrasterized', async () => {
    const render = vi.fn();
    await desugar(
      { ...visualComponent(), enabled: false },
      { services: { pptx: { render } } }
    );

    expect(render).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('throws an actionable error when the service is unreachable', async () => {
    mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(desugar(visualComponent())).rejects.toThrow(/services\.pptx/s);
  });

  describe('batching across a document (#153)', () => {
    it('rasterizes two identical visuals once between them', async () => {
      const render = vi.fn().mockResolvedValue({
        base64DataUri: PNG_DATA_URI,
        width: 1,
        height: 1,
      });

      await desugarExternals(
        {
          name: 'docx',
          props: {},
          children: [visualComponent(), visualComponent()],
        },
        { theme: createMockTheme(), services: { pptx: { render } } }
      );

      expect(render).toHaveBeenCalledOnce();
    });

    it('rasterizes visuals that differ separately', async () => {
      const render = vi.fn().mockResolvedValue({
        base64DataUri: PNG_DATA_URI,
        width: 1,
        height: 1,
      });

      await desugarExternals(
        {
          name: 'docx',
          props: {},
          children: [
            visualComponent(),
            visualComponent({ canvas: { width: 3, height: 2 } }),
          ],
        },
        { theme: createMockTheme(), services: { pptx: { render } } }
      );

      expect(render).toHaveBeenCalledTimes(2);
    });

    it('surfaces a recorded batch failure against the visual it belongs to', async () => {
      const renderBatch = vi.fn().mockResolvedValue({
        results: [{ ok: false, error: 'slide 3 is broken' }],
      });

      await expect(
        desugar(visualComponent(), { services: { pptx: { renderBatch } } })
      ).rejects.toThrow('slide 3 is broken');
    });

    it('keys a serverUrl-overridden visual distinctly under an HTTP config', async () => {
      // A visual pointing at its own server must not be served from a batch
      // keyed against the shared one.
      await desugar(visualComponent({ serverUrl: 'http://prop-server:1234' }), {
        services: { pptx: { serverUrl: 'http://services:5555' } },
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://prop-server:1234/rasterize',
        expect.any(Object)
      );
    });
  });

  describe('fonts reaching the rasterizer', () => {
    const fonts = [
      { family: 'Inter', weight: 400, italic: false, data: 'AAECAw==' },
    ];

    it('forwards them to an in-process render', async () => {
      const render = vi.fn().mockResolvedValue({
        base64DataUri: PNG_DATA_URI,
        width: 1200,
        height: 800,
      });

      await desugar(visualComponent(), {
        services: { pptx: { render } },
        visualFonts: fonts,
      });

      expect(render.mock.calls[0][0].fonts).toEqual(fonts);
    });

    it('forwards them in the HTTP body', async () => {
      await desugar(visualComponent(), {
        services: { pptx: { serverUrl: 'http://svc:9000' } },
        visualFonts: fonts,
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.fonts).toEqual(fonts);
    });

    it('emits no fonts key when there are none', async () => {
      const render = vi.fn().mockResolvedValue({
        base64DataUri: PNG_DATA_URI,
        width: 1200,
        height: 800,
      });

      await desugar(visualComponent(), { services: { pptx: { render } } });

      expect(render.mock.calls[0][0]).not.toHaveProperty('fonts');
    });

    it('leaves visualRasterKey untouched by fonts (three args, by design)', () => {
      // The pre-pass map lives inside ONE build, which has exactly one font
      // set, so the pre-pass and the per-visual fallback can never disagree
      // about fonts. Keying on them here would only fragment the map. The
      // load-bearing font key is the rasterizer's own on-disk cache key.
      expect(visualRasterKey.length).toBe(3);
      const presentation = buildVisualPresentation(visualProps() as never);
      expect(visualRasterKey(presentation, 200)).toBe(
        visualRasterKey(presentation, 200)
      );
    });
  });

  it('carries its placement props onto the image it becomes', async () => {
    const props = visualProps({
      width: 320,
      alignment: 'right',
      caption: 'A figure',
      alt: 'Described',
    });

    expect(visualToImageProps(props as never, PNG_DATA_URI)).toEqual({
      base64: PNG_DATA_URI,
      width: 320,
      alignment: 'right',
      caption: 'A figure',
      alt: 'Described',
    });
  });

  it('compiles all the way to an image once rasterized', async () => {
    const render = vi.fn().mockResolvedValue({
      base64DataUri: PNG_DATA_URI,
      width: 1,
      height: 1,
    });

    const compiled = await compileDocumentToIr(
      {
        name: 'docx',
        props: {},
        children: [visualComponent({ width: 100 })],
      } as unknown as ReportComponentDefinition,
      { services: { pptx: { render } } as never }
    );

    const [block] = compiled.ir.sections[0].children;
    expect(block.kind).toBe('paragraph');
    if (block.kind !== 'paragraph') return;
    expect(block.children[0].kind).toBe('image');
  });
});
