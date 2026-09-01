/**
 * How a `highcharts` chart reaches the export server, and what it becomes.
 *
 * The chart itself is drawn by a service, so everything worth checking is on
 * the way there: which server is called, with which headers, and with which
 * colour palette. What comes back is an ordinary image, and the corpus covers
 * images.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { isValidThemeConfig } from '@json-to-office/shared-docx';
import { createMockTheme } from './helpers';
import { devportalTheme } from '../../templates/themes';
import type { ThemeConfig } from '../../styles';

// Force a Node environment: chart export refuses to run in a browser.
vi.mock('../../utils/environment', () => ({
  isNodeEnvironment: vi.fn().mockReturnValue(true),
  isBrowserEnvironment: vi.fn().mockReturnValue(false),
}));

import { renderChartToImageProps } from '../highcharts';
import { desugarExternals } from '../../core/desugarExternals';

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

  describe('rendering a chart', () => {
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

      const result = await renderChartToImageProps(
        component.props as never,
        createMockTheme()
      );

      expect(result.base64).toMatch(/^data:image\/png;base64,/);
    }, 60_000);

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

      const result = await renderChartToImageProps(
        component.props as never,
        createMockTheme()
      );

      expect(result.base64).toMatch(/^data:image\/png;base64,/);
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

      const result = await renderChartToImageProps(
        component.props as never,
        createMockTheme()
      );

      expect(result.base64).toMatch(/^data:image\/png;base64,/);
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

      const result = await renderChartToImageProps(
        component.props as never,
        createMockTheme()
      );

      expect(result.base64).toMatch(/^data:image\/png;base64,/);
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

      const result = await renderChartToImageProps(
        component.props as never,
        createMockTheme()
      );

      expect(result.base64).toMatch(/^data:image\/png;base64,/);
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

      const result = await renderChartToImageProps(
        component.props as never,
        createMockTheme()
      );

      expect(result.base64).toMatch(/^data:image\/png;base64,/);
    });

    it('leaves a component that is not a chart alone', async () => {
      const document = await desugarExternals(
        {
          name: 'docx',
          props: {},
          children: [{ name: 'paragraph', props: { text: 'Not a chart' } }],
        },
        { theme: createMockTheme() }
      );

      expect(document.children[0].name).toBe('paragraph');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('turns a chart into an image, centred, at the size it asked for', async () => {
      const document = await desugarExternals(
        {
          name: 'docx',
          props: {},
          children: [
            {
              name: 'highcharts',
              props: {
                options: {
                  chart: { width: 400, height: 300 },
                  series: [{ type: 'column', data: [1, 2, 3] }],
                },
              },
            },
          ],
        },
        { theme: createMockTheme() }
      );

      expect(document.children[0]).toEqual({
        name: 'image',
        props: expect.objectContaining({
          width: 400,
          height: 300,
          alignment: 'center',
        }),
      });
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

      const result = await renderChartToImageProps(
        component.props as never,
        createMockTheme()
      );

      expect(result.base64).toMatch(/^data:image\/png;base64,/);
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

      const result = await renderChartToImageProps(
        component.props as never,
        theme
      );

      expect(result.base64).toMatch(/^data:image\/png;base64,/);
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

      const result = await renderChartToImageProps(
        component.props as never,
        createMockTheme()
      );

      expect(result.base64).toMatch(/^data:image\/png;base64,/);
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
        renderChartToImageProps(component.props as never, createMockTheme())
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

      await renderChartToImageProps(
        component.props as never,
        createMockTheme()
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

      await renderChartToImageProps(
        component.props as never,
        createMockTheme(),
        context.services?.highcharts
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

      await renderChartToImageProps(
        component.props as never,
        createMockTheme(),
        context.services?.highcharts
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

      await renderChartToImageProps(
        component.props as never,
        createMockTheme(),
        context.services?.highcharts
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

      await renderChartToImageProps(
        component.props as never,
        createMockTheme(),
        context.services?.highcharts
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

      await renderChartToImageProps(
        component.props as never,
        createMockTheme(),
        context.services?.highcharts
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

      await renderChartToImageProps(
        component.props as never,
        createMockTheme()
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

      await renderChartToImageProps(
        component.props as never,
        createMockTheme()
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

      await renderChartToImageProps(
        component.props as never,
        createMockTheme()
      );

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      // Backward compatible: no resources key sent.
      expect('resources' in body).toBe(false);
    });
  });

  describe('theme palette injection', () => {
    const chartComponent = {
      name: 'highcharts' as const,
      props: {
        options: {
          chart: { width: 600, height: 400 },
          series: [{ type: 'bar' as const, data: [1, 2, 3] }],
        },
      },
    };

    it('injects the full shared chart palette when the theme defines every token', async () => {
      // Built on a bundled theme so the input is one an author could actually
      // load: accent4-6 are optional keys of the theme schema, not a cast.
      const theme: ThemeConfig = {
        ...devportalTheme,
        colors: {
          ...devportalTheme.colors,
          accent4: '#AA1111',
          accent5: '#22BB22',
          accent6: '#3333CC',
        },
      };
      expect(isValidThemeConfig(theme)).toBe(true);

      await renderChartToImageProps(chartComponent.props as never, theme);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      // Same token order as PPTX: primary, secondary, accent, accent4-6.
      expect(body.infile.colors).toEqual([
        '#12191F',
        '#172028',
        '#E35B3F',
        '#AA1111',
        '#22BB22',
        '#3333CC',
      ]);
    });

    it('skips tokens the theme leaves undefined, compacting the hole', async () => {
      // accent5 defined, accent4 not: the omitted slot is dropped rather than
      // emitted as undefined or padded with a repeat, so accent5 slides up into
      // the fourth series. Documented on DEFAULT_CHART_THEME_COLORS: the token
      // list is a preference-ordered pool, not fixed per-series slots.
      const theme: ThemeConfig = {
        ...createMockTheme(),
        colors: {
          ...createMockTheme().colors,
          accent5: '#5555AA',
        },
      };

      await renderChartToImageProps(chartComponent.props as never, theme);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.infile.colors).toEqual([
        '#0066cc',
        '#6c757d',
        '#17a2b8',
        '#5555AA',
      ]);
    });

    it('resolves a token whose value names another token', async () => {
      // The theme schema allows "accent4": "primary" — a name reference, which
      // resolveColor walks. Blindly prefixing '#' would post "#primary".
      const theme: ThemeConfig = {
        ...createMockTheme(),
        colors: {
          ...createMockTheme().colors,
          accent4: 'primary',
          accent5: 'textSecondary',
        },
      };

      await renderChartToImageProps(chartComponent.props as never, theme);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.infile.colors).toEqual([
        '#0066cc',
        '#6c757d',
        '#17a2b8',
        '#0066CC',
        '#666666',
      ]);
      expect(body.infile.colors).not.toContain('#primary');
    });

    it('drops a token whose value resolves to nothing', async () => {
      const theme: ThemeConfig = {
        ...createMockTheme(),
        colors: {
          ...createMockTheme().colors,
          accent4: 'notAThemeColor',
        },
      };

      await renderChartToImageProps(chartComponent.props as never, theme);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.infile.colors).toEqual(['#0066cc', '#6c757d', '#17a2b8']);
    });

    it('matches the PPTX palette for a theme that leaves accent4-6 unset', async () => {
      // Cross-format parity. The sibling PPTX test
      // "matches the DOCX palette for a theme that leaves accent4-6 unset"
      // (packages/core-pptx/src/components/__tests__/highcharts.test.ts) posts
      // this exact array for the same three theme colors — package boundaries
      // keep the two renderers out of one test file, so the expectation is
      // pinned identically on both sides.
      const theme: ThemeConfig = {
        ...createMockTheme(),
        colors: {
          ...createMockTheme().colors,
          primary: '#111111',
          secondary: '#222222',
          accent: '#CC785C',
        },
      };

      await renderChartToImageProps(chartComponent.props as never, theme);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.infile.colors).toEqual(['#111111', '#222222', '#CC785C']);
    });

    it('emits the full six-color palette for a bundled theme, which defines accent4-6', async () => {
      await renderChartToImageProps(
        chartComponent.props as never,
        devportalTheme
      );

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.infile.colors).toEqual([
        devportalTheme.colors.primary,
        devportalTheme.colors.secondary,
        devportalTheme.colors.accent,
        devportalTheme.colors.accent4,
        devportalTheme.colors.accent5,
        devportalTheme.colors.accent6,
      ]);
      // Pinned so a palette change in the theme JSON is a visible diff here.
      expect(body.infile.colors).toEqual([
        '#12191F',
        '#172028',
        '#E35B3F',
        '#46494C',
        '#8A9299',
        '#E8A18D',
      ]);
    });

    it('normalizes theme colors stored without a leading #', async () => {
      const theme: ThemeConfig = {
        ...createMockTheme(),
        colors: {
          ...createMockTheme().colors,
          primary: 'FF0000',
          accent4: 'AABBCC',
        },
      };

      await renderChartToImageProps(chartComponent.props as never, theme);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.infile.colors).toEqual([
        '#FF0000',
        '#6c757d',
        '#17a2b8',
        '#AABBCC',
      ]);
    });

    it('leaves explicit options.colors untouched', async () => {
      const component = {
        name: 'highcharts' as const,
        props: {
          options: {
            chart: { width: 600, height: 400 },
            colors: ['#ABCDEF'],
            series: [{ type: 'bar' as const, data: [1, 2, 3] }],
          },
        },
      };

      await renderChartToImageProps(
        component.props as never,
        createMockTheme()
      );

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.infile.colors).toEqual(['#ABCDEF']);
    });
  });
});
