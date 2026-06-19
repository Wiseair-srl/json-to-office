import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Paragraph } from 'docx';
import { createMockTheme, TEST_THEME_NAME } from './helpers';

// Mock createImage and createText functions
vi.mock('../../core/content', async () => {
  const { Paragraph } = await vi.importActual<typeof import('docx')>('docx');
  return {
    createImage: vi.fn().mockResolvedValue([new Paragraph({})]),
    createText: vi.fn().mockReturnValue(new Paragraph({})),
  };
});

// Mock placeholder image
vi.mock('../../utils/placeholderImage', () => ({
  createPlaceholderImageFile: vi.fn().mockResolvedValue('/tmp/placeholder.png'),
}));

import { renderHighchartsComponent } from '../highcharts';
import { createImage } from '../../core/content';

const mockCreateImage = createImage as any;

// Mock environment utils
vi.mock('../../utils/environment', () => ({
  isNodeEnvironment: vi.fn().mockReturnValue(true),
  isBrowserEnvironment: vi.fn().mockReturnValue(false),
}));

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('components/highcharts', { timeout: 30000 }, () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset modules to avoid multiple event listener registration
    vi.resetModules();

    // Setup default fetch mock - return a fake base64 string
    mockFetch.mockResolvedValue({
      ok: true,
      text: vi
        .fn()
        .mockResolvedValue(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
        ),
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  describe('renderHighchartsComponent', () => {
    it('should render chart with basic configuration', async () => {
      const component = {
        name: 'highcharts' as const,
        props: {
          options: {
            chart: {
              width: 600,
              height: 400,
            },
            title: { text: 'Test Chart' },
            series: [
              {
                type: 'line' as const,
                data: [1, 2, 3, 4, 5],
              },
            ],
          },
        },
      };

      const result = await renderHighchartsComponent(
        component,
        createMockTheme(),
        TEST_THEME_NAME
      );

      expect(mockCreateImage).toHaveBeenCalled();
      expect(result).toHaveLength(1);
      expect(result[0]).toBeInstanceOf(Paragraph);
    }, 10000);

    it('should handle chart with dimensions', async () => {
      const component = {
        name: 'highcharts' as const,
        props: {
          options: {
            chart: {
              width: 800,
              height: 600,
            },
            title: { text: 'Sized Chart' },
            series: [{ type: 'bar' as const, data: [1, 2, 3] }],
          },
        },
      };

      const result = await renderHighchartsComponent(
        component,
        createMockTheme(),
        TEST_THEME_NAME
      );

      expect(mockCreateImage).toHaveBeenCalled();
      expect(result).toHaveLength(1);
    });

    it('should handle multiple series', async () => {
      const component = {
        name: 'highcharts' as const,
        props: {
          options: {
            chart: {
              width: 600,
              height: 400,
            },
            title: { text: 'Multi-series Chart' },
            series: [
              { type: 'line' as const, name: 'Series 1', data: [1, 2, 3] },
              { type: 'line' as const, name: 'Series 2', data: [3, 2, 1] },
              { type: 'column' as const, name: 'Series 3', data: [2, 2, 2] },
            ],
          },
        },
      };

      const result = await renderHighchartsComponent(
        component,
        createMockTheme(),
        TEST_THEME_NAME
      );

      expect(result).toHaveLength(1);
    });

    it('should handle chart with axes configuration', async () => {
      const component = {
        name: 'highcharts' as const,
        props: {
          options: {
            chart: {
              width: 600,
              height: 400,
            },
            title: { text: 'Chart with Axes' },
            xAxis: {
              title: { text: 'X Axis' },
              categories: ['Jan', 'Feb', 'Mar', 'Apr', 'May'],
            },
            yAxis: {
              title: { text: 'Y Axis' },
              min: 0,
              max: 100,
            },
            series: [{ type: 'line' as const, data: [10, 30, 50, 70, 90] }],
          },
        },
      };

      const result = await renderHighchartsComponent(
        component,
        createMockTheme(),
        TEST_THEME_NAME
      );

      expect(result).toHaveLength(1);
    });

    it('should handle chart with legend configuration', async () => {
      const component = {
        name: 'highcharts' as const,
        props: {
          options: {
            chart: {
              width: 600,
              height: 400,
            },
            title: { text: 'Chart with Legend' },
            legend: {
              align: 'right' as const,
              verticalAlign: 'middle' as const,
              layout: 'vertical' as const,
            },
            series: [
              { type: 'line' as const, name: 'Data 1', data: [1, 2, 3] },
              { type: 'line' as const, name: 'Data 2', data: [3, 2, 1] },
            ],
          },
        },
      };

      const result = await renderHighchartsComponent(
        component,
        createMockTheme(),
        TEST_THEME_NAME
      );

      expect(result).toHaveLength(1);
    });

    it('should handle chart with tooltip configuration', async () => {
      const component = {
        name: 'highcharts' as const,
        props: {
          options: {
            chart: {
              width: 600,
              height: 400,
            },
            title: { text: 'Chart with Tooltip' },
            tooltip: {
              enabled: true,
              format: '{point.y:.2f}',
              shared: true,
            },
            series: [{ type: 'line' as const, data: [1.111, 2.222, 3.333] }],
          },
        },
      };

      const result = await renderHighchartsComponent(
        component,
        createMockTheme(),
        TEST_THEME_NAME
      );

      expect(result).toHaveLength(1);
    });

    it('should handle non-highcharts component type', async () => {
      const component = {
        name: 'paragraph' as const,
        props: { content: 'Not a chart' },
      };

      const result = await renderHighchartsComponent(
        component,
        createMockTheme(),
        TEST_THEME_NAME
      );

      expect(result).toHaveLength(0);
      expect(result).toEqual([]);
      expect(mockCreateImage).not.toHaveBeenCalled();
    });

    it('should handle empty chart options', async () => {
      const component = {
        name: 'highcharts' as const,
        props: {
          options: {
            chart: {
              width: 600,
              height: 400,
            },
            title: { text: 'Test Chart' },
            series: [{ data: [1, 2, 3] }],
          },
        },
      };

      const result = await renderHighchartsComponent(
        component,
        createMockTheme(),
        TEST_THEME_NAME
      );

      expect(result).toHaveLength(1);
    });

    it('should apply theme colors to chart', async () => {
      const theme = createMockTheme({
        colors: {
          primary: 'FF0000',
          secondary: '00FF00',
          accent: '0000FF',
          text: '000000',
          background: 'FFFFFF',
        },
      });

      const component = {
        name: 'highcharts' as const,
        props: {
          options: {
            chart: {
              width: 600,
              height: 400,
            },
            title: { text: 'Themed Chart' },
            series: [{ type: 'line' as const, data: [1, 2, 3] }],
          },
        },
      };

      const result = await renderHighchartsComponent(
        component,
        theme,
        TEST_THEME_NAME
      );

      expect(result).toHaveLength(1);
    });

    it('should handle large datasets', async () => {
      const largeData = Array.from({ length: 1000 }, (_, i) => i);

      const component = {
        name: 'highcharts' as const,
        props: {
          options: {
            chart: {
              width: 600,
              height: 400,
            },
            title: { text: 'Large Dataset Chart' },
            series: [{ type: 'line' as const, data: largeData }],
          },
        },
      };

      const result = await renderHighchartsComponent(
        component,
        createMockTheme(),
        TEST_THEME_NAME
      );

      expect(result).toHaveLength(1);
    });

    it('throws when export server unavailable', async () => {
      mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));

      const component = {
        name: 'highcharts' as const,
        props: {
          options: {
            chart: {
              width: 600,
              height: 400,
            },
            title: { text: 'Error Chart' },
            series: [{ type: 'line' as const, data: [1, 2, 3] }],
          },
        },
      };

      await expect(
        renderHighchartsComponent(component, createMockTheme(), TEST_THEME_NAME)
      ).rejects.toThrow(/not running.*enableServer/s);
    });

    it('should use custom serverUrl prop', async () => {
      const component = {
        name: 'highcharts' as const,
        props: {
          options: {
            chart: { width: 600, height: 400 },
            series: [{ data: [1, 2, 3] }],
          },
          serverUrl: 'http://custom-server:9999',
        },
      };

      await renderHighchartsComponent(
        component,
        createMockTheme(),
        TEST_THEME_NAME
      );

      expect(mockFetch).toHaveBeenCalledWith(
        'http://custom-server:9999/export',
        expect.any(Object)
      );
    });

    it('should use services config serverUrl', async () => {
      const component = {
        name: 'highcharts' as const,
        props: {
          options: {
            chart: { width: 600, height: 400 },
            series: [{ data: [1, 2, 3] }],
          },
        },
      };

      const context = {
        services: {
          highcharts: { serverUrl: 'http://services-server:5555' },
        },
      } as any;

      await renderHighchartsComponent(
        component,
        createMockTheme(),
        TEST_THEME_NAME,
        context
      );

      expect(mockFetch).toHaveBeenCalledWith(
        'http://services-server:5555/export',
        expect.any(Object)
      );
    });

    it('should prioritize per-component serverUrl over services config', async () => {
      const component = {
        name: 'highcharts' as const,
        props: {
          options: {
            chart: { width: 600, height: 400 },
            series: [{ data: [1, 2, 3] }],
          },
          serverUrl: 'http://prop-server:7777',
        },
      };

      const context = {
        services: {
          highcharts: { serverUrl: 'http://services-server:5555' },
        },
      } as any;

      await renderHighchartsComponent(
        component,
        createMockTheme(),
        TEST_THEME_NAME,
        context
      );

      expect(mockFetch).toHaveBeenCalledWith(
        'http://prop-server:7777/export',
        expect.any(Object)
      );
    });

    it('should merge services headers into fetch request', async () => {
      const component = {
        name: 'highcharts' as const,
        props: {
          options: {
            chart: { width: 600, height: 400 },
            series: [{ data: [1, 2, 3] }],
          },
        },
      };

      const context = {
        services: {
          highcharts: {
            headers: { 'x-api-key': 'test-key-123' },
          },
        },
      } as any;

      await renderHighchartsComponent(
        component,
        createMockTheme(),
        TEST_THEME_NAME,
        context
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

    it('should resolve headers via function called with request body', async () => {
      const component = {
        name: 'highcharts' as const,
        props: {
          options: {
            chart: { width: 600, height: 400 },
            series: [{ data: [1, 2, 3] }],
          },
          scale: 2,
        },
      };

      const headersFn = vi.fn((body: any) => ({
        'x-signature': `sig-${body.scale ?? 1}`,
      }));

      const context = {
        services: { highcharts: { headers: headersFn } },
      } as any;

      await renderHighchartsComponent(
        component,
        createMockTheme(),
        TEST_THEME_NAME,
        context
      );

      expect(headersFn).toHaveBeenCalledOnce();
      expect(headersFn).toHaveBeenCalledWith(
        expect.objectContaining({
          infile: expect.objectContaining({
            chart: { width: 600, height: 400 },
          }),
          type: 'png',
          b64: true,
          scale: 2,
        })
      );
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            'x-signature': 'sig-2',
          }),
        })
      );
    });

    it('should await async headers function', async () => {
      const component = {
        name: 'highcharts' as const,
        props: {
          options: {
            chart: { width: 600, height: 400 },
            series: [{ data: [1, 2, 3] }],
          },
        },
      };

      const headersFn = vi
        .fn()
        .mockResolvedValue({ authorization: 'Bearer async-token' });

      const context = {
        services: { highcharts: { headers: headersFn } },
      } as any;

      await renderHighchartsComponent(
        component,
        createMockTheme(),
        TEST_THEME_NAME,
        context
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

    it('should send only Content-Type when no services config', async () => {
      const component = {
        name: 'highcharts' as const,
        props: {
          options: {
            chart: { width: 600, height: 400 },
            series: [{ data: [1, 2, 3] }],
          },
        },
      };

      await renderHighchartsComponent(
        component,
        createMockTheme(),
        TEST_THEME_NAME
      );

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: { 'Content-Type': 'application/json' },
        })
      );
    });

    it('should forward resources verbatim to the export server when present', async () => {
      const resources = {
        css: "@font-face { font-family: 'Manrope'; src: url('https://cdn.example/manrope.woff2') format('woff2'); }",
        js: 'console.log("ready")',
        files: ['https://cdn.example/extra.css'],
      };

      const component = {
        name: 'highcharts' as const,
        props: {
          options: {
            chart: {
              width: 600,
              height: 400,
              style: { fontFamily: 'Manrope' },
            },
            series: [{ data: [1, 2, 3] }],
          },
          resources,
        },
      };

      await renderHighchartsComponent(
        component,
        createMockTheme(),
        TEST_THEME_NAME
      );

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      // Forwarded verbatim, untransformed.
      expect(body.resources).toEqual(resources);
    });

    it('should omit resources from the request body when not provided', async () => {
      const component = {
        name: 'highcharts' as const,
        props: {
          options: {
            chart: { width: 600, height: 400 },
            series: [{ data: [1, 2, 3] }],
          },
        },
      };

      await renderHighchartsComponent(
        component,
        createMockTheme(),
        TEST_THEME_NAME
      );

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      // Backward compatible: no resources key sent.
      expect('resources' in body).toBe(false);
    });
  });
});
