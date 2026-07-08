import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHighchartsComponent } from '../highcharts';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const FAKE_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

function mockSlide() {
  return { addImage: vi.fn() } as any;
}

const theme = {} as any;

describe('renderHighchartsComponent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockResolvedValue({
      ok: true,
      text: vi.fn().mockResolvedValue(FAKE_B64),
    });
  });

  it('calls addImage with base64 data URI and derived dimensions', async () => {
    const slide = mockSlide();
    await renderHighchartsComponent(
      slide,
      {
        options: { chart: { width: 960, height: 480 } },
      },
      theme
    );

    expect(mockFetch).toHaveBeenCalledOnce();
    expect(slide.addImage).toHaveBeenCalledWith(
      expect.objectContaining({
        data: `data:image/png;base64,${FAKE_B64}`,
        w: 10, // 960/96
        h: 5, // 480/96
      })
    );
  });

  it('uses explicit w/h when provided', async () => {
    const slide = mockSlide();
    await renderHighchartsComponent(
      slide,
      {
        options: { chart: { width: 600, height: 400 } },
        x: 1,
        y: 2,
        w: 8,
        h: 4,
      },
      theme
    );

    expect(slide.addImage).toHaveBeenCalledWith(
      expect.objectContaining({ x: 1, y: 2, w: 8, h: 4 })
    );
  });

  it('passes scale to export server', async () => {
    const slide = mockSlide();
    await renderHighchartsComponent(
      slide,
      {
        options: { chart: { width: 600, height: 400 } },
        scale: 2,
      },
      theme
    );

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.scale).toBe(2);
  });

  it('throws when export server unavailable', async () => {
    mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const slide = mockSlide();

    await expect(
      renderHighchartsComponent(
        slide,
        { options: { chart: { width: 600, height: 400 } } },
        theme
      )
    ).rejects.toThrow(/not running.*enableServer/s);
  });

  it('throws on non-ok response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    });
    const slide = mockSlide();

    await expect(
      renderHighchartsComponent(
        slide,
        { options: { chart: { width: 600, height: 400 } } },
        theme
      )
    ).rejects.toThrow(/returned 500/);
  });

  it('uses custom serverUrl prop', async () => {
    const slide = mockSlide();
    await renderHighchartsComponent(
      slide,
      {
        options: { chart: { width: 600, height: 400 } },
        serverUrl: 'http://custom-server:9999',
      },
      theme
    );

    expect(mockFetch).toHaveBeenCalledWith(
      'http://custom-server:9999/export',
      expect.any(Object)
    );
  });

  it('uses services config serverUrl', async () => {
    const slide = mockSlide();
    await renderHighchartsComponent(
      slide,
      { options: { chart: { width: 600, height: 400 } } },
      theme,
      undefined,
      { serverUrl: 'http://services-server:5555' }
    );

    expect(mockFetch).toHaveBeenCalledWith(
      'http://services-server:5555/export',
      expect.any(Object)
    );
  });

  it('prioritizes per-component serverUrl over services config', async () => {
    const slide = mockSlide();
    await renderHighchartsComponent(
      slide,
      {
        options: { chart: { width: 600, height: 400 } },
        serverUrl: 'http://prop-server:7777',
      },
      theme,
      undefined,
      { serverUrl: 'http://services-server:5555' }
    );

    expect(mockFetch).toHaveBeenCalledWith(
      'http://prop-server:7777/export',
      expect.any(Object)
    );
  });

  it('merges services headers into fetch request', async () => {
    const slide = mockSlide();
    await renderHighchartsComponent(
      slide,
      { options: { chart: { width: 600, height: 400 } } },
      theme,
      undefined,
      { headers: { 'x-api-key': 'test-key-123' } }
    );

    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          'x-api-key': 'test-key-123',
        }),
      })
    );
  });

  it('resolves headers via function called with request body', async () => {
    const slide = mockSlide();
    const headersFn = vi.fn((body: any) => ({
      'x-signature': `sig-${body.scale ?? 1}`,
    }));

    await renderHighchartsComponent(
      slide,
      {
        options: { chart: { width: 600, height: 400 } },
        scale: 3,
      },
      theme,
      undefined,
      { headers: headersFn }
    );

    expect(headersFn).toHaveBeenCalledOnce();
    expect(headersFn).toHaveBeenCalledWith(
      expect.objectContaining({
        infile: { chart: { width: 600, height: 400 } },
        type: 'png',
        b64: true,
        scale: 3,
      })
    );
    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          'x-signature': 'sig-3',
        }),
      })
    );
  });

  it('awaits async headers function', async () => {
    const slide = mockSlide();
    const headersFn = vi
      .fn()
      .mockResolvedValue({ authorization: 'Bearer async-token' });

    await renderHighchartsComponent(
      slide,
      { options: { chart: { width: 600, height: 400 } } },
      theme,
      undefined,
      { headers: headersFn }
    );

    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: 'Bearer async-token',
        }),
      })
    );
  });

  it('sends only Content-Type when no services config', async () => {
    const slide = mockSlide();
    await renderHighchartsComponent(
      slide,
      { options: { chart: { width: 600, height: 400 } } },
      theme
    );

    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: { 'Content-Type': 'application/json' },
      })
    );
  });

  it('forwards resources verbatim to the export server when present', async () => {
    const slide = mockSlide();
    const resources = {
      css: "@font-face { font-family: 'Manrope'; src: url('https://cdn.example/manrope.woff2') format('woff2'); }",
      js: 'console.log("ready")',
      files: ['https://cdn.example/extra.css'],
    };

    await renderHighchartsComponent(
      slide,
      {
        options: {
          chart: { width: 600, height: 400, style: { fontFamily: 'Manrope' } },
        },
        resources,
      },
      theme
    );

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    // Forwarded verbatim, untransformed.
    expect(body.resources).toEqual(resources);
  });

  it('omits resources from the request body when not provided', async () => {
    const slide = mockSlide();
    await renderHighchartsComponent(
      slide,
      { options: { chart: { width: 600, height: 400 } } },
      theme
    );

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    // Backward compatible: no resources key sent.
    expect('resources' in body).toBe(false);
  });

  describe('theme palette injection', () => {
    const brandTheme = {
      colors: {
        primary: '#111111',
        secondary: '#222222',
        accent: '#CC785C',
        background: '#FFFFFF',
        text: '#1A1A1A',
      },
    } as any;

    it('injects the theme palette when options.colors is absent', async () => {
      const slide = mockSlide();
      await renderHighchartsComponent(
        slide,
        { options: { chart: { width: 600, height: 400 } } },
        brandTheme
      );

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      // First three tokens resolve to the theme colors; accent4-6 are unset
      // on this theme and fall back to primary.
      expect(body.infile.colors.slice(0, 3)).toEqual([
        '#111111',
        '#222222',
        '#CC785C',
      ]);
      expect(body.infile.colors).toHaveLength(6);
    });

    it('leaves explicit options.colors untouched', async () => {
      const slide = mockSlide();
      await renderHighchartsComponent(
        slide,
        {
          options: {
            chart: { width: 600, height: 400 },
            colors: ['#ABCDEF'],
          },
        },
        brandTheme
      );

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.infile.colors).toEqual(['#ABCDEF']);
    });

    it('skips injection when the theme has no colors', async () => {
      const slide = mockSlide();
      await renderHighchartsComponent(
        slide,
        { options: { chart: { width: 600, height: 400 } } },
        theme
      );

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect('colors' in body.infile).toBe(false);
    });
  });
});
