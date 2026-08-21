import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  collectVisualProps,
  prerasterizeVisuals,
} from '../prerasterizeVisuals';
import {
  visualRasterKey,
  buildVisualPresentation,
} from '../../components/visual';
import { clampVisualDpi, DEFAULT_VISUAL_DPI } from '@json-to-office/shared';

const PNG = 'data:image/png;base64,AAAA';

const okResult = { base64DataUri: PNG, width: 960, height: 640 };

const visual = (text: string, extra: Record<string, unknown> = {}) => ({
  name: 'visual',
  props: {
    canvas: { width: 6, height: 3 },
    elements: [{ name: 'text', props: { text } }],
    ...extra,
  },
});

/** Map key a visual's props resolve to under in-process/default-server config. */
const keyOf = (props: any, dpi = DEFAULT_VISUAL_DPI) =>
  visualRasterKey(buildVisualPresentation(props), clampVisualDpi(dpi));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('collectVisualProps', () => {
  it('finds visuals nested in children, table cells, and section headers/footers', () => {
    const root = [
      {
        components: [
          visual('top'),
          {
            name: 'columns',
            props: {},
            children: [visual('in-column')],
          },
          {
            name: 'table',
            props: {
              columns: [
                {
                  header: { content: visual('in-header-cell') },
                  cells: [{ content: visual('in-cell') }, { content: 'txt' }],
                },
              ],
            },
          },
        ],
        header: [visual('in-page-header')],
        footer: 'linkToPrevious',
      },
    ];
    const found = collectVisualProps(root);
    expect(found.map((p: any) => p.elements[0].props.text)).toEqual([
      'top',
      'in-column',
      'in-header-cell',
      'in-cell',
      'in-page-header',
    ]);
  });

  it('prunes disabled visuals and disabled ancestor components', () => {
    const root = [
      {
        components: [
          { ...visual('off'), enabled: false },
          {
            name: 'section',
            enabled: false,
            props: {},
            children: [visual('inside-disabled-section')],
          },
          visual('on'),
        ],
      },
    ];
    const found = collectVisualProps(root);
    expect(found.map((p: any) => p.elements[0].props.text)).toEqual(['on']);
  });

  it('does not descend into a visual (pptx subtree cannot hold docx visuals)', () => {
    const nested = visual('outer', {
      elements: [visual('this-is-a-pptx-node-not-a-docx-visual')],
    });
    expect(collectVisualProps([nested])).toHaveLength(1);
  });

  it('survives cyclic objects and cyclic arrays', () => {
    const section: Record<string, unknown> = {
      name: 'section',
      children: [visual('in-cycle')],
    };
    section.owner = section;
    const cyclicArray: unknown[] = [section];
    cyclicArray.push(cyclicArray);
    const found = collectVisualProps(cyclicArray);
    expect(found.map((p: any) => p.elements[0].props.text)).toEqual([
      'in-cycle',
    ]);
  });
});

describe('prerasterizeVisuals (in-process batch)', () => {
  it('coalesces unique visuals into one renderBatch call and dedupes identical ones', async () => {
    const renderBatch = vi.fn(async (req: any) => ({
      results: req.slides.map(() => ({ ok: true, ...okResult })),
    }));
    const doc = [visual('a'), visual('a'), visual('b', { dpi: 300 })];

    const map = await prerasterizeVisuals(
      doc,
      { renderBatch },
      { baseDir: '/docs' }
    );

    expect(renderBatch).toHaveBeenCalledOnce();
    const req = renderBatch.mock.calls[0][0];
    expect(req.slides).toHaveLength(2); // 'a' deduped
    expect(req.slides[1].dpi).toBe(300);
    expect(req.baseDir).toBe('/docs');
    expect(map.size).toBe(2);
    expect(map.get(keyOf(doc[0].props))).toMatchObject({
      ok: true,
      base64DataUri: PNG,
    });
    expect(map.get(keyOf(doc[2].props, 300))).toMatchObject({ ok: true });
  });

  it('chunks batches above MAX_RASTERIZE_BATCH_SLIDES', async () => {
    const renderBatch = vi.fn(async (req: any) => ({
      results: req.slides.map(() => ({ ok: true, ...okResult })),
    }));
    const doc = Array.from({ length: 33 }, (_, i) => visual(`v${i}`));

    const map = await prerasterizeVisuals(doc, { renderBatch });

    expect(renderBatch).toHaveBeenCalledTimes(2);
    expect(renderBatch.mock.calls[0][0].slides).toHaveLength(32);
    expect(renderBatch.mock.calls[1][0].slides).toHaveLength(1);
    expect(map.size).toBe(33);
  });

  it('records per-slide errors from the batch response', async () => {
    const renderBatch = vi.fn(async () => ({
      results: [
        { ok: true, ...okResult },
        { ok: false, error: 'bad slide' },
      ],
    }));
    const doc = [visual('good'), visual('broken')];

    const map = await prerasterizeVisuals(doc, { renderBatch });

    expect(map.get(keyOf(doc[0].props))).toMatchObject({ ok: true });
    expect(map.get(keyOf(doc[1].props))).toEqual({
      ok: false,
      error: 'bad slide',
    });
  });

  it('falls back to the single rasterizer when the batch call fails', async () => {
    const renderBatch = vi.fn(async () => {
      throw new Error('batch exploded');
    });
    const render = vi.fn(async () => okResult);
    const doc = [visual('a'), visual('b')];

    const map = await prerasterizeVisuals(doc, { renderBatch, render });

    expect(render).toHaveBeenCalledTimes(2);
    expect(map.get(keyOf(doc[0].props))).toMatchObject({ ok: true });
  });

  it('falls back per-visual when the batch response is malformed (wrong length)', async () => {
    const renderBatch = vi.fn(async () => ({
      results: [{ ok: true, ...okResult }],
    }));
    const render = vi.fn(async () => okResult);
    const doc = [visual('a'), visual('b')];

    const map = await prerasterizeVisuals(doc, { renderBatch, render });

    expect(render).toHaveBeenCalledTimes(2);
    expect(map.size).toBe(2);
  });

  it('records the batch error per visual when no single rasterizer exists', async () => {
    const renderBatch = vi.fn(async () => {
      throw new Error('soffice missing');
    });
    const doc = [visual('a')];

    const map = await prerasterizeVisuals(doc, { renderBatch });

    expect(map.get(keyOf(doc[0].props))).toEqual({
      ok: false,
      error: 'soffice missing',
    });
  });

  it('falls back to the configured HTTP server when the batch fails and no render exists', async () => {
    const renderBatch = vi.fn(async () => {
      throw new Error('batch exploded');
    });
    mockFetch.mockResolvedValue({ ok: true, json: async () => okResult });
    const doc = [visual('a')];

    const map = await prerasterizeVisuals(doc, {
      renderBatch,
      serverUrl: 'http://svc:9000',
    });

    // The document must keep building through the reachable HTTP service —
    // a renderBatch failure with a configured serverUrl is not fatal.
    expect(mockFetch).toHaveBeenCalledWith(
      'http://svc:9000/rasterize',
      expect.any(Object)
    );
    expect(map.get(keyOf(doc[0].props))).toMatchObject({ ok: true });
  });

  it('skips a malformed visual without losing batching for the rest', async () => {
    const renderBatch = vi.fn(async (req: any) => ({
      results: req.slides.map(() => ({ ok: true, ...okResult })),
    }));
    const doc = [
      { name: 'visual', props: {} }, // no canvas — buildVisualPresentation throws
      visual('fine'),
    ];

    const map = await prerasterizeVisuals(doc, { renderBatch });

    expect(renderBatch).toHaveBeenCalledOnce();
    expect(renderBatch.mock.calls[0][0].slides).toHaveLength(1);
    expect(map.get(keyOf((doc[1] as any).props))).toMatchObject({ ok: true });
  });
});

describe('prerasterizeVisuals (in-process single render)', () => {
  it('rasterizes unique visuals through render with recorded errors per visual', async () => {
    const render = vi
      .fn()
      .mockResolvedValueOnce(okResult)
      .mockRejectedValueOnce(new Error('nope'));
    const doc = [visual('a'), visual('b')];

    const map = await prerasterizeVisuals(doc, { render });

    expect(render).toHaveBeenCalledTimes(2);
    expect(map.get(keyOf(doc[0].props))).toMatchObject({ ok: true });
    expect(map.get(keyOf(doc[1].props))).toEqual({ ok: false, error: 'nope' });
  });
});

describe('prerasterizeVisuals (HTTP)', () => {
  it('POSTs one /rasterize/batch request and seeds the map', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [
          { ok: true, ...okResult },
          { ok: true, ...okResult },
        ],
      }),
    });
    const doc = [visual('a'), visual('b')];

    const map = await prerasterizeVisuals(doc, {
      serverUrl: 'http://svc:9000',
    });

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe('http://svc:9000/rasterize/batch');
    const body = JSON.parse(init.body);
    expect(body.slides).toHaveLength(2);
    expect(map.size).toBe(2);
  });

  it('falls back to per-visual /rasterize calls when the batch endpoint is missing (older server)', async () => {
    mockFetch.mockImplementation(async (url: string) => {
      if (url.endsWith('/rasterize/batch')) {
        return { ok: false, status: 404, statusText: 'Not Found' };
      }
      return { ok: true, json: async () => okResult };
    });
    const doc = [visual('a'), visual('b')];

    const map = await prerasterizeVisuals(doc, {
      serverUrl: 'http://old:9000',
    });

    const urls = mockFetch.mock.calls.map((c) => c[0]);
    expect(urls[0]).toBe('http://old:9000/rasterize/batch');
    expect(urls.filter((u) => u === 'http://old:9000/rasterize')).toHaveLength(
      2
    );
    expect(map.size).toBe(2);
    expect(map.get(keyOf(doc[0].props))).toMatchObject({ ok: true });
  });

  it('leaves visuals with a per-visual serverUrl override to the render-time path', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ results: [{ ok: true, ...okResult }] }),
    });
    const doc = [
      visual('default-server'),
      visual('other', { serverUrl: 'http://other:1' }),
    ];

    const map = await prerasterizeVisuals(doc, {
      serverUrl: 'http://svc:9000',
    });

    expect(mockFetch).toHaveBeenCalledOnce();
    expect(JSON.parse(mockFetch.mock.calls[0][1].body).slides).toHaveLength(1);
    expect(map.size).toBe(1);
  });

  it('returns an empty map without touching the network when there are no visuals', async () => {
    const map = await prerasterizeVisuals(
      [{ name: 'paragraph', props: { text: 'x' } }],
      { serverUrl: 'http://svc:9000' }
    );
    expect(map.size).toBe(0);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe('font forwarding (Area 6)', () => {
  const fonts = [
    {
      family: 'Inter',
      weight: 400,
      italic: false,
      data: 'AAECAw==',
      format: 'ttf' as const,
    },
  ];

  it('puts fonts at the REQUEST level of an in-process batch, never per-slide', async () => {
    const renderBatch = vi.fn(async () => ({
      results: [{ ok: true, ...okResult }],
    }));
    await prerasterizeVisuals([visual('a')], { renderBatch }, { fonts });

    const request = renderBatch.mock.calls[0][0] as any;
    expect(request.fonts).toEqual(fonts);
    // The per-slide object is validated with additionalProperties:false on
    // the server; it must stay exactly {presentation, dpi}.
    expect(Object.keys(request.slides[0]).sort()).toEqual([
      'dpi',
      'presentation',
    ]);
  });

  it('puts fonts at the REQUEST level of the HTTP batch body', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ results: [{ ok: true, ...okResult }] }),
    });
    await prerasterizeVisuals(
      [visual('a')],
      { serverUrl: 'http://svc:9000' },
      { fonts }
    );

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.fonts).toEqual(fonts);
    expect(Object.keys(body.slides[0]).sort()).toEqual(['dpi', 'presentation']);
  });

  it('forwards fonts to the per-visual fallback rasterizer', async () => {
    const render = vi.fn(async () => okResult);
    await prerasterizeVisuals([visual('a')], { render }, { fonts });
    expect((render.mock.calls[0][0] as any).fonts).toEqual(fonts);
  });

  it('emits NO fonts key when options.fonts is absent or empty', async () => {
    const renderBatch = vi.fn(async () => ({
      results: [{ ok: true, ...okResult }],
    }));
    await prerasterizeVisuals([visual('a')], { renderBatch }, {});
    expect(renderBatch.mock.calls[0][0]).not.toHaveProperty('fonts');

    renderBatch.mockClear();
    await prerasterizeVisuals([visual('a')], { renderBatch }, { fonts: [] });
    expect(renderBatch.mock.calls[0][0]).not.toHaveProperty('fonts');
  });

  it('retries the HTTP batch once without fonts when a pre-fonts server 400s', async () => {
    // A render server predating this feature validates the body with
    // additionalProperties:false, so `fonts` is a hard 400 rather than an
    // ignored extra. One fontless retry turns that into the old behaviour.
    mockFetch.mockImplementation(async (_url: string, init: any) => {
      const body = JSON.parse(init.body);
      if (body.fonts) return { ok: false, status: 400, text: async () => 'no' };
      return {
        ok: true,
        json: async () => ({ results: [{ ok: true, ...okResult }] }),
      };
    });

    const doc = [visual('a')];
    const map = await prerasterizeVisuals(
      doc,
      { serverUrl: 'http://old:9000' },
      { fonts }
    );

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(JSON.parse(mockFetch.mock.calls[0][1].body).fonts).toEqual(fonts);
    expect(JSON.parse(mockFetch.mock.calls[1][1].body)).not.toHaveProperty(
      'fonts'
    );
    expect(map.get(keyOf(doc[0].props))).toMatchObject({ ok: true });
  });

  it('does NOT latch the fontless downgrade after a transient batch failure', async () => {
    // Regression: a 503 on one chunk used to trigger the fontless retry, and
    // that retry succeeding latched `fontsRejected` for the REST of the
    // document — every later visual silently rendered with the wrong fonts.
    // Only a 400 (what additionalProperties:false produces) may latch.
    let batchCalls = 0;
    mockFetch.mockImplementation(async (url: string, init: any) => {
      const body = JSON.parse(init.body);
      if (url.endsWith('/rasterize/batch')) {
        batchCalls++;
        if (batchCalls === 1) {
          return { ok: false, status: 503, statusText: 'Service Unavailable' };
        }
        return {
          ok: true,
          json: async () => ({
            results: body.slides.map(() => ({ ok: true, ...okResult })),
          }),
        };
      }
      return { ok: true, json: async () => okResult };
    });

    // 33 visuals → two chunks, so the second chunk observes the latch.
    const doc = Array.from({ length: 33 }, (_, i) => visual(`v${i}`));
    const map = await prerasterizeVisuals(
      doc,
      { serverUrl: 'http://flaky:9000' },
      { fonts }
    );

    const batchBodies = mockFetch.mock.calls
      .filter((c) => (c[0] as string).endsWith('/rasterize/batch'))
      .map((c) => JSON.parse(c[1].body));
    // A 5xx is not evidence about the body: no fontless batch retry at all.
    expect(batchBodies).toHaveLength(2);
    // The second chunk must still carry the document's fonts.
    expect(batchBodies[1].fonts).toEqual(fonts);
    // …and so must the per-visual fallback the failed first chunk took.
    const perVisual = mockFetch.mock.calls.filter(
      (c) => c[0] === 'http://flaky:9000/rasterize'
    );
    expect(perVisual).toHaveLength(32);
    expect(JSON.parse(perVisual[0][1].body).fonts).toEqual(fonts);
    expect(map.size).toBe(33);
  });

  it('retries a per-visual /rasterize without fonts when an old server 400s', async () => {
    // Regression: the version-skew retry existed only on the batch path. When
    // BOTH batch attempts fail, the per-visual fallback still sent `fonts` to
    // an old `additionalProperties:false` /rasterize, got a 400, and the
    // document failed outright instead of degrading to fontless visuals.
    mockFetch.mockImplementation(async (url: string, init: any) => {
      if (url.endsWith('/rasterize/batch')) {
        return { ok: false, status: 404, statusText: 'Not Found' };
      }
      if (JSON.parse(init.body).fonts) {
        return { ok: false, status: 400, statusText: 'Bad Request' };
      }
      return { ok: true, json: async () => okResult };
    });

    const doc = [visual('a'), visual('b')];
    const map = await prerasterizeVisuals(
      doc,
      { serverUrl: 'http://old:9000' },
      { fonts, concurrency: 1 }
    );

    expect(map.get(keyOf(doc[0].props))).toMatchObject({ ok: true });
    expect(map.get(keyOf(doc[1].props))).toMatchObject({ ok: true });

    const perVisualFonts = mockFetch.mock.calls
      .filter((c) => c[0] === 'http://old:9000/rasterize')
      .map((c) => JSON.parse(c[1].body).fonts);
    // First visual: fonts → 400, then a fontless retry. The proven rejection
    // latches, so the second visual goes out fontless straight away.
    expect(perVisualFonts).toEqual([fonts, undefined, undefined]);
  });

  it('keeps sending fonts when the fontless retry also fails (transport error)', async () => {
    // Only a SUCCESSFUL fontless retry proves the field was the problem; a
    // flat-out unreachable server must not silently cost the rest of the
    // document its font fidelity.
    //
    // This has to run over HTTP: an in-process `render` short-circuits
    // rasterizeVisualSlide before any fetch, so a config carrying one would
    // never reach isSchemaRejection and would pass without touching the
    // branch. Batch 404s (old server) → per-visual; the fonts-bearing body
    // 400s (schema rejection, the only thing that may latch); the fontless
    // retry 503s (transport), so nothing is proven.
    mockFetch.mockImplementation(async (url: string, init: any) => {
      if (url.endsWith('/rasterize/batch')) {
        return { ok: false, status: 404, statusText: 'Not Found' };
      }
      if (JSON.parse(init.body).fonts) {
        return { ok: false, status: 400, statusText: 'Bad Request' };
      }
      return { ok: false, status: 503, statusText: 'Service Unavailable' };
    });

    const doc = [visual('a'), visual('b')];
    const map = await prerasterizeVisuals(
      doc,
      { serverUrl: 'http://down:9000' },
      { fonts, concurrency: 1 }
    );

    const perVisualFonts = mockFetch.mock.calls
      .filter((c) => c[0] === 'http://down:9000/rasterize')
      .map((c) => JSON.parse(c[1].body).fonts);
    // Visual 'a': fonts → 400, fontless retry → 503. The retry failing means
    // the fonts were never shown to be the problem, so visual 'b' must still
    // lead with them (a latch would make the third entry `undefined`).
    expect(perVisualFonts).toEqual([fonts, undefined, fonts, undefined]);

    // Both visuals report the ORIGINAL 400, not the speculative retry's 503.
    expect(map.get(keyOf(doc[0].props))).toEqual({
      ok: false,
      error: expect.stringContaining('400'),
    });
    expect(map.get(keyOf(doc[1].props))).toEqual({
      ok: false,
      error: expect.stringContaining('400'),
    });
  });
});
