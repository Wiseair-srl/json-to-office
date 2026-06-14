import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Paragraph } from 'docx';
import { createMockTheme, TEST_THEME_NAME } from './helpers';

// Mock createImage so we can assert the desugaring without touching the docx lib
vi.mock('../../core/content', async () => {
  const { Paragraph } = await vi.importActual<typeof import('docx')>('docx');
  return {
    createImage: vi.fn().mockResolvedValue([new Paragraph({})]),
    createText: vi.fn().mockReturnValue(new Paragraph({})),
  };
});

import { renderVisualComponent } from '../visual';
import { createImage } from '../../core/content';

const mockCreateImage = createImage as any;

// Force Node environment
vi.mock('../../utils/environment', () => ({
  isNodeEnvironment: vi.fn().mockReturnValue(true),
  isBrowserEnvironment: vi.fn().mockReturnValue(false),
}));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const PNG_DATA_URI =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

function visualComponent(props: Record<string, unknown> = {}) {
  return {
    name: 'visual' as const,
    props: {
      canvas: { width: 6, height: 4 },
      elements: [
        { name: 'text', props: { text: 'Hi', x: 1, y: 1, w: 4, h: 1 } },
      ],
      ...props,
    },
  } as any;
}

describe('components/visual', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockResolvedValue({
      ok: true,
      json: vi
        .fn()
        .mockResolvedValue({
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
    const render = vi
      .fn()
      .mockResolvedValue({
        base64DataUri: PNG_DATA_URI,
        width: 1200,
        height: 800,
      });

    const context = { services: { pptx: { render } } } as any;

    const result = await renderVisualComponent(
      visualComponent(),
      createMockTheme(),
      TEST_THEME_NAME,
      context
    );

    expect(render).toHaveBeenCalledOnce();
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockCreateImage).toHaveBeenCalledWith(
      PNG_DATA_URI,
      expect.anything(),
      TEST_THEME_NAME,
      expect.objectContaining({
        // canvas is 6in → default rendered width = 6 * 96 px
        width: 576,
        alignment: 'center',
      })
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toBeInstanceOf(Paragraph);
  });

  it('builds a single-slide pptx presentation from canvas + elements', async () => {
    const render = vi
      .fn()
      .mockResolvedValue({
        base64DataUri: PNG_DATA_URI,
        width: 10,
        height: 10,
      });

    await renderVisualComponent(
      visualComponent({
        canvas: {
          width: 7.5,
          height: 10,
          theme: 'mono',
          background: { color: '#EEE' },
        },
      }),
      createMockTheme(),
      TEST_THEME_NAME,
      { services: { pptx: { render } } } as any
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

    // default
    await renderVisualComponent(
      visualComponent(),
      createMockTheme(),
      TEST_THEME_NAME,
      {
        services: { pptx: { render } },
      } as any
    );
    expect(render.mock.calls[0][0].dpi).toBe(200);

    // services default
    render.mockClear();
    await renderVisualComponent(
      visualComponent(),
      createMockTheme(),
      TEST_THEME_NAME,
      {
        services: { pptx: { render, dpi: 144 } },
      } as any
    );
    expect(render.mock.calls[0][0].dpi).toBe(144);

    // per-component override
    render.mockClear();
    await renderVisualComponent(
      visualComponent({ dpi: 300 }),
      createMockTheme(),
      TEST_THEME_NAME,
      { services: { pptx: { render, dpi: 144 } } } as any
    );
    expect(render.mock.calls[0][0].dpi).toBe(300);
  });

  it('POSTs to {serverUrl}/rasterize and parses the JSON result', async () => {
    const context = {
      services: { pptx: { serverUrl: 'http://localhost:9000' } },
    } as any;

    await renderVisualComponent(
      visualComponent(),
      createMockTheme(),
      TEST_THEME_NAME,
      context
    );

    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:9000/rasterize',
      expect.objectContaining({ method: 'POST' })
    );
    expect(mockCreateImage).toHaveBeenCalledWith(
      PNG_DATA_URI,
      expect.anything(),
      TEST_THEME_NAME,
      expect.objectContaining({ width: 576 })
    );
  });

  it('prefers per-component serverUrl over services config', async () => {
    await renderVisualComponent(
      visualComponent({ serverUrl: 'http://prop-server:1234' }),
      createMockTheme(),
      TEST_THEME_NAME,
      { services: { pptx: { serverUrl: 'http://services:5555' } } } as any
    );

    expect(mockFetch).toHaveBeenCalledWith(
      'http://prop-server:1234/rasterize',
      expect.any(Object)
    );
  });

  it('returns [] for a non-visual component', async () => {
    const result = await renderVisualComponent(
      { name: 'paragraph', props: { text: 'x' } } as any,
      createMockTheme(),
      TEST_THEME_NAME
    );
    expect(result).toEqual([]);
    expect(mockCreateImage).not.toHaveBeenCalled();
  });

  it('throws an actionable error when the service is unreachable', async () => {
    mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    await expect(
      renderVisualComponent(
        visualComponent(),
        createMockTheme(),
        TEST_THEME_NAME
      )
    ).rejects.toThrow(/services\.pptx/s);
  });
});
