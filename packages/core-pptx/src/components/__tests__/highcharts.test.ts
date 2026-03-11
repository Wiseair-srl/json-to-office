import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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

  it('uses HIGHCHARTS_SERVER_URL env var', async () => {
    process.env.HIGHCHARTS_SERVER_URL = 'http://env-server:8080';
    const slide = mockSlide();

    await renderHighchartsComponent(
      slide,
      { options: { chart: { width: 600, height: 400 } } },
      theme
    );

    expect(mockFetch).toHaveBeenCalledWith(
      'http://env-server:8080/export',
      expect.any(Object)
    );

    delete process.env.HIGHCHARTS_SERVER_URL;
  });

  it('prioritizes serverUrl prop over env var', async () => {
    process.env.HIGHCHARTS_SERVER_URL = 'http://env-server:8080';
    const slide = mockSlide();

    await renderHighchartsComponent(
      slide,
      {
        options: { chart: { width: 600, height: 400 } },
        serverUrl: 'http://prop-server:7777',
      },
      theme
    );

    expect(mockFetch).toHaveBeenCalledWith(
      'http://prop-server:7777/export',
      expect.any(Object)
    );

    delete process.env.HIGHCHARTS_SERVER_URL;
  });
});
