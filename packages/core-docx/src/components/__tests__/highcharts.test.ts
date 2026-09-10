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
import {
  getChartRequestStats,
  resetChartLimiters,
  resetChartRequestStats,
  type GenerationWarning,
} from '@json-to-office/shared';
import { createMockTheme } from './helpers';
import { minimalTheme, vermilionTheme } from '../../templates/themes';
import { resolveDocxDesignSystem } from '../../themes/design-system';
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

  describe('where the chart data goes', () => {
    const chart = {
      options: {
        chart: { width: 600, height: 400 },
        series: [{ data: [1, 2, 3] }],
      },
    };

    it('posts to the local export server when nothing configures one', async () => {
      await renderChartToImageProps(chart as never, createMockTheme());
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:7801/export',
        expect.any(Object)
      );
    });

    it.each(['http://10.0.0.5:7801', 'http://charts.internal'])(
      'treats %s as private and posts without opting in',
      async (url) => {
        await renderChartToImageProps(
          { ...chart, serverUrl: url } as never,
          createMockTheme()
        );
        expect(mockFetch).toHaveBeenCalledWith(
          `${url}/export`,
          expect.any(Object)
        );
      }
    );

    it('refuses a public export server, naming the switch, before any data leaves', async () => {
      await expect(
        renderChartToImageProps(
          { ...chart, serverUrl: 'https://export.highcharts.com' } as never,
          createMockTheme()
        )
      ).rejects.toThrow(
        /export\.highcharts\.com.*allowRemote.*HIGHCHARTS_ALLOW_REMOTE/s
      );
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('posts to a public server once allowed, and says so in the warnings', async () => {
      const warnings: { message: string; context?: Record<string, unknown> }[] =
        [];
      await renderChartToImageProps(
        chart as never,
        createMockTheme(),
        { serverUrl: 'https://charts.example.com', allowRemote: true },
        undefined,
        warnings
      );
      expect(mockFetch).toHaveBeenCalledWith(
        'https://charts.example.com/export',
        expect.any(Object)
      );
      expect(warnings).toEqual([
        expect.objectContaining({
          component: 'highcharts',
          message: expect.stringContaining('https://charts.example.com'),
          context: {
            code: 'W_HIGHCHARTS_REMOTE_EXPORT',
            serverUrl: 'https://charts.example.com',
          },
        }),
      ]);
    });
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
      mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));

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
          serverUrl: 'http://custom-server.internal:9999',
        },
      };

      await renderChartToImageProps(
        component.props as never,
        createMockTheme()
      );

      expect(mockFetch).toHaveBeenCalledWith(
        'http://custom-server.internal:9999/export',
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
          highcharts: { serverUrl: 'http://services-server.internal:5555' },
        },
      } as any;

      await renderChartToImageProps(
        component.props as never,
        createMockTheme(),
        context.services?.highcharts
      );

      expect(mockFetch).toHaveBeenCalledWith(
        'http://services-server.internal:5555/export',
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
          serverUrl: 'http://prop-server.internal:7777',
        },
      };

      const context = {
        services: {
          highcharts: { serverUrl: 'http://services-server.internal:5555' },
        },
      } as any;

      await renderChartToImageProps(
        component.props as never,
        createMockTheme(),
        context.services?.highcharts
      );

      expect(mockFetch).toHaveBeenCalledWith(
        'http://prop-server.internal:7777/export',
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
            chart: expect.objectContaining({ width: 600, height: 400 }),
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
    it('uses the ordered visual palette and preserves explicit chart colors', async () => {
      const theme = {
        ...minimalTheme,
        palette: {
          positive: '#337755',
          rule: '#123456',
          chart: ['positive', 'rule'],
        },
      };
      const options = {
        chart: { width: 600, height: 400 },
        series: [{ type: 'bar', data: [1, 2] }],
      };
      await renderChartToImageProps({ options } as never, theme);
      expect(JSON.parse(mockFetch.mock.calls[0][1].body).infile.colors).toEqual(
        ['#337755', '#123456']
      );
      await renderChartToImageProps(
        { options: { ...options, colors: ['#ABCDEF'] } } as never,
        theme
      );
      expect(JSON.parse(mockFetch.mock.calls[1][1].body).infile.colors).toEqual(
        ['#ABCDEF']
      );
    });
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
        ...minimalTheme,
        colors: {
          ...minimalTheme.colors,
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
        minimalTheme.colors.primary,
        minimalTheme.colors.secondary,
        minimalTheme.colors.accent,
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
      // minimal: accent4-6 present, no palette.chart of its own, so the
      // legacy slot order is the series; a theme with a palette (consulting,
      // vermilion, devportal) orders the series itself.
      await renderChartToImageProps(
        chartComponent.props as never,
        minimalTheme
      );

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.infile.colors).toEqual([
        minimalTheme.colors.primary,
        minimalTheme.colors.secondary,
        minimalTheme.colors.accent,
        minimalTheme.colors.accent4,
        minimalTheme.colors.accent5,
        minimalTheme.colors.accent6,
      ]);
      // Pinned so a palette change in the theme JSON is a visible diff here.
      expect(body.infile.colors).toEqual([
        '#2B302B',
        '#4A5B4E',
        '#6E7F71',
        '#9AA69C',
        '#C9CFC7',
        '#B5AC9D',
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

describe('theme typography injection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockResolvedValue({
      ok: true,
      text: vi.fn().mockResolvedValue('AA=='),
    });
  });
  const request = () => JSON.parse(mockFetch.mock.calls[0][1].body);
  const chart = {
    options: {
      chart: { width: 900, height: 480 },
      series: [{ type: 'column', data: [1, 2, 3] }],
    },
  };

  it('sets the chart in the theme faces, sizes and ink at 96 dpi when unplaced', async () => {
    await renderChartToImageProps(chart as never, vermilionTheme);
    const { infile } = request();
    expect(infile.chart.style).toEqual({ fontFamily: '"Calibri", sans-serif' });
    // Title: heading face, heading3 size (11pt) and weight, primary ink.
    expect(infile.title.style).toEqual({
      fontFamily: '"Arial", sans-serif',
      fontSize: '14.7px',
      fontWeight: '700',
      color: '#282829',
    });
    // Labels one point under the 10.5pt body; secondary ink for axis text.
    expect(infile.xAxis.labels.style).toEqual({
      fontSize: '12.7px',
      color: '#58595B',
    });
    expect(infile.yAxis.title.style).toEqual({
      fontSize: '12.7px',
      color: '#58595B',
    });
    expect(infile.legend.itemStyle).toEqual({
      fontSize: '12.7px',
      color: '#282829',
    });
    expect(infile.credits).toEqual({
      enabled: false,
      style: { fontSize: '11.3px', color: '#58595B' },
    });
    expect(infile.series).toEqual(chart.options.series);
  });

  it('scales the sizes by the width the chart is placed at', async () => {
    // "100%" of the vermilion A4 measure: 11906 − 2 × 1152 twips = 480.1pt
    // for 900 chart pixels, so a 9.5pt label is drawn at 17.8px.
    await renderChartToImageProps(
      { ...chart, width: '100%' } as never,
      vermilionTheme
    );
    expect(request().infile.legend.itemStyle.fontSize).toBe('17.8px');
    // 600 image pixels = 450pt for the same 900 chart pixels: half a point each.
    await renderChartToImageProps(
      { ...chart, width: 600 } as never,
      vermilionTheme
    );
    expect(
      JSON.parse(mockFetch.mock.calls[1][1].body).infile.legend.itemStyle
        .fontSize
    ).toBe('19px');
  });

  it('reads the chartLabel and source roles once the theme declares them', async () => {
    const theme = resolveDocxDesignSystem({
      ...vermilionTheme,
      typography: {
        roles: {
          chartLabel: { size: 9, weight: 400, color: 'textMuted' },
          source: { size: 8 },
        },
      },
    });
    await renderChartToImageProps(chart as never, theme);
    const { infile } = request();
    expect(infile.legend.itemStyle).toEqual({
      fontSize: '12px',
      color: '#282829',
      fontWeight: '400',
    });
    expect(infile.plotOptions.series.dataLabels.style.fontWeight).toBe('400');
    expect(infile.credits.style.fontSize).toBe('10.7px');
  });

  it('never overrides an explicit author setting', async () => {
    await renderChartToImageProps(
      {
        options: {
          ...chart.options,
          chart: { ...chart.options.chart, style: { fontFamily: 'Inter' } },
          title: {
            text: 'Mine',
            style: { fontSize: '30px', color: '#FF0000' },
          },
          legend: { itemStyle: { fontWeight: 'bold' } },
        },
      } as never,
      vermilionTheme
    );
    const { infile } = request();
    expect(infile.chart.style).toEqual({ fontFamily: 'Inter' });
    expect(infile.title.style).toMatchObject({
      fontSize: '30px',
      color: '#FF0000',
      fontFamily: '"Arial", sans-serif',
    });
    expect(infile.legend.itemStyle.fontWeight).toBe('bold');
  });

  it('inlines the staged faces of the theme families as @font-face, before author CSS', async () => {
    const theme: ThemeConfig = {
      ...vermilionTheme,
      fonts: { ...vermilionTheme.fonts, body: { family: 'Inter', size: 10 } },
    };
    const faces = [
      {
        family: 'Inter',
        weight: 400,
        italic: false,
        data: 'AAAA',
        format: 'ttf' as const,
      },
      {
        family: 'Unused',
        weight: 400,
        italic: false,
        data: 'BBBB',
        format: 'ttf' as const,
      },
    ];
    await renderChartToImageProps(
      { ...chart, resources: { css: '.mine{}' } } as never,
      theme,
      undefined,
      faces
    );
    const body = request();
    expect(body.infile.chart.style.fontFamily).toBe('"Inter", sans-serif');
    expect(body.resources.css).toBe(
      '@font-face{font-family:"Inter";font-weight:400;font-style:normal;' +
        'src:url(data:font/ttf;base64,AAAA) format("truetype")}\n.mine{}'
    );
    expect(body.resources.css).not.toContain('Unused');
  });

  it('sends no resources when no staged face matches', async () => {
    await renderChartToImageProps(chart as never, vermilionTheme, undefined, [
      { family: 'Unused', weight: 400, italic: false, data: 'BBBB' },
    ]);
    expect('resources' in request()).toBe(false);
  });
});

/**
 * What a document does to a single-worker export server.
 *
 * The walk desugars sibling components with `Promise.all`, so the thing worth
 * asserting is not how many requests are made but how many are open at once:
 * an unbounded document posts all fifty charts before the first PNG comes
 * back, which is exactly the shape that made every one of them time out.
 */
describe('bounded chart concurrency', () => {
  /** A fake export server that records how many requests it holds at once. */
  function countingExportServer(): {
    peak: () => number;
    calls: () => number;
    handler: () => Promise<{ ok: true; text: () => Promise<string> }>;
  } {
    let inFlight = 0;
    let peak = 0;
    let calls = 0;
    return {
      peak: () => peak,
      calls: () => calls,
      handler: async () => {
        calls++;
        inFlight++;
        peak = Math.max(peak, inFlight);
        // A real render is not instantaneous; without a turn of the event
        // loop here every request would look serial whatever the cap is.
        await new Promise((resolve) => setTimeout(resolve, 1));
        inFlight--;
        return { ok: true, text: async () => 'AA==' };
      },
    };
  }

  /** `count` charts that differ, so dedupe cannot stand in for the cap. */
  function documentWithCharts(
    count: number,
    serverUrl?: string
  ): Record<string, unknown> {
    return {
      name: 'docx',
      props: {},
      children: Array.from({ length: count }, (_, index) => ({
        name: 'highcharts',
        props: {
          options: {
            chart: { width: 400, height: 300 },
            series: [{ type: 'column', data: [index, index + 1] }],
          },
          ...(serverUrl ? { serverUrl } : {}),
        },
      })),
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    // The gate outlives a document by design, so a test that inherited one
    // from another test would be asserting the wrong cap.
    resetChartLimiters();
  });

  it('never opens more than the default four requests at once, over fifty charts', async () => {
    const server = countingExportServer();
    mockFetch.mockImplementation(server.handler);

    await desugarExternals(documentWithCharts(50), {
      theme: createMockTheme(),
    });

    expect(server.calls()).toBe(50);
    expect(server.peak()).toBe(4);
  });

  it('honours a configured cap', async () => {
    const server = countingExportServer();
    mockFetch.mockImplementation(server.handler);

    await desugarExternals(documentWithCharts(20), {
      theme: createMockTheme(),
      services: { highcharts: { concurrency: 2 } },
    });

    expect(server.peak()).toBe(2);
  });

  it('holds the cap across documents rendered together in one process', async () => {
    const server = countingExportServer();
    mockFetch.mockImplementation(server.handler);

    await Promise.all([
      desugarExternals(documentWithCharts(20), { theme: createMockTheme() }),
      desugarExternals(documentWithCharts(20), { theme: createMockTheme() }),
      desugarExternals(documentWithCharts(20), { theme: createMockTheme() }),
    ]);

    expect(server.calls()).toBe(60);
    expect(server.peak()).toBe(4);
  });

  it('gives a second export server its own pool', async () => {
    const perUrl = new Map<string, { inFlight: number; peak: number }>();
    mockFetch.mockImplementation(async (url: string) => {
      const state = perUrl.get(url) ?? { inFlight: 0, peak: 0 };
      perUrl.set(url, state);
      state.inFlight++;
      state.peak = Math.max(state.peak, state.inFlight);
      await new Promise((resolve) => setTimeout(resolve, 1));
      state.inFlight--;
      return { ok: true, text: async () => 'AA==' };
    });

    await Promise.all([
      desugarExternals(documentWithCharts(20, 'http://charts-a.internal'), {
        theme: createMockTheme(),
      }),
      desugarExternals(documentWithCharts(20, 'http://charts-b.internal'), {
        theme: createMockTheme(),
      }),
    ]);

    expect(perUrl.get('http://charts-a.internal/export')?.peak).toBe(4);
    expect(perUrl.get('http://charts-b.internal/export')?.peak).toBe(4);
  });
});

/**
 * What a transient export server costs a document.
 *
 * A single-worker server restarting, or shedding load with a 429, used to
 * take the whole document with it: one chart's failure is the document's
 * failure. A retry is only worth having if it can tell that apart from a
 * chart the server will refuse however many times it is asked.
 */
describe('retrying a chart the export server could not answer', () => {
  const chart = {
    options: {
      chart: { width: 400, height: 300 },
      series: [{ type: 'column', data: [1, 2, 3] }],
    },
  };
  const ok = { ok: true, text: async () => 'AA==' };
  const status = (code: number, statusText = 'Boom'): unknown => ({
    ok: false,
    status: code,
    statusText,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    resetChartLimiters();
  });

  it('renders the chart once a retry lands', async () => {
    mockFetch
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockResolvedValue(ok);

    const props = await renderChartToImageProps(
      chart as never,
      createMockTheme()
    );

    expect(props.base64).toBe('data:image/png;base64,AA==');
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it.each([429, 500, 503])('retries a %d', async (code) => {
    mockFetch.mockResolvedValueOnce(status(code)).mockResolvedValue(ok);

    await renderChartToImageProps(chart as never, createMockTheme());

    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('gives up after the retry budget, keeping the message it always had', async () => {
    mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(
      renderChartToImageProps(chart as never, createMockTheme())
    ).rejects.toThrow(/not running.*enableServer.*after 3 attempts/s);
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('still reports an exhausted timeout as a service outage', async () => {
    mockFetch.mockRejectedValue(
      Object.assign(new Error('aborted'), { name: 'AbortError' })
    );

    await expect(
      renderChartToImageProps(chart as never, createMockTheme())
    ).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
  });

  it('fails a rejected chart payload on the first attempt, verbatim', async () => {
    mockFetch.mockResolvedValue(status(400, 'Bad Request'));

    await expect(
      renderChartToImageProps(chart as never, createMockTheme())
    ).rejects.toThrow('Highcharts export server returned 400: Bad Request');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it.each([401, 404, 422])('does not retry a %d either', async (code) => {
    mockFetch.mockResolvedValue(status(code));

    await expect(
      renderChartToImageProps(chart as never, createMockTheme())
    ).rejects.toThrow(new RegExp(`returned ${code}`));
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});

describe('what the host can dial', () => {
  const chart = {
    options: {
      chart: { width: 400, height: 300 },
      series: [{ type: 'column', data: [1, 2, 3] }],
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    resetChartLimiters();
  });

  it('aborts at the configured timeout, and names it', async () => {
    // A server that accepts the connection and never answers is the shape
    // the abort exists for; without it the render waits forever.
    mockFetch.mockImplementation(
      (_url: string, init: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () =>
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
          );
        })
    );

    await expect(
      renderChartToImageProps(chart as never, createMockTheme(), {
        timeoutMs: 20,
        retries: 0,
      })
    ).rejects.toThrow(/timed out after 20ms/);
  });

  it('aborts a body that stalls after the headers arrive', async () => {
    // The abort used to be disarmed as soon as the headers landed, so a
    // service that answered 200 and then stalled the stream hung the render
    // for good — the exact failure the timeout is there to prevent.
    mockFetch.mockImplementation(
      async (_url: string, init: { signal: AbortSignal }) => ({
        ok: true,
        text: () =>
          new Promise((_resolve, reject) => {
            init.signal.addEventListener('abort', () =>
              reject(
                Object.assign(new Error('aborted'), { name: 'AbortError' })
              )
            );
          }),
      })
    );

    await expect(
      renderChartToImageProps(chart as never, createMockTheme(), {
        timeoutMs: 20,
        retries: 0,
      })
    ).rejects.toThrow(/timed out after 20ms/);
  });

  it('takes the retry budget from the config', async () => {
    mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(
      renderChartToImageProps(chart as never, createMockTheme(), { retries: 0 })
    ).rejects.toThrow(/not running/);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    mockFetch.mockClear();
    await expect(
      renderChartToImageProps(chart as never, createMockTheme(), { retries: 1 })
    ).rejects.toThrow(/after 2 attempts/);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});

describe('rendering a repeated chart once', () => {
  const chartProps = (data: number[]): Record<string, unknown> => ({
    options: {
      chart: { width: 400, height: 300 },
      series: [{ type: 'column', data }],
    },
  });

  beforeEach(() => {
    vi.clearAllMocks();
    resetChartLimiters();
    mockFetch.mockResolvedValue({ ok: true, text: async () => 'AA==' });
  });

  it('posts one request for a chart that appears three times', async () => {
    const document = await desugarExternals(
      {
        name: 'docx',
        props: {},
        children: [
          { name: 'highcharts', props: chartProps([1, 2, 3]) },
          { name: 'highcharts', props: chartProps([1, 2, 3]) },
          { name: 'highcharts', props: chartProps([1, 2, 3]) },
        ],
      },
      { theme: createMockTheme() }
    );

    expect(mockFetch).toHaveBeenCalledTimes(1);
    // Every appearance still gets the image, not just the first.
    for (const child of document.children) {
      expect(child).toMatchObject({
        name: 'image',
        props: { base64: 'data:image/png;base64,AA==' },
      });
    }
  });

  it('does not let repeats of one chart occupy the gate', async () => {
    // A duplicate has no request to make, so it must not hold a slot a chart
    // with real work could use. Three distinct charts behind forty copies of
    // one figure: all four renders must be able to run together, which they
    // cannot if the copies are queuing.
    let inFlight = 0;
    let peak = 0;
    mockFetch.mockImplementation(async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 1));
      inFlight--;
      return { ok: true, text: async () => 'AA==' };
    });

    await desugarExternals(
      {
        name: 'docx',
        props: {},
        children: [
          ...Array.from({ length: 40 }, () => ({
            name: 'highcharts',
            props: chartProps([1, 2, 3]),
          })),
          ...Array.from({ length: 3 }, (_, index) => ({
            name: 'highcharts',
            props: chartProps([index + 10, index + 11]),
          })),
        ],
      },
      { theme: createMockTheme() }
    );

    // One render for the forty repeats plus three distinct ones, all four in
    // flight at once. Queue the copies instead and the peak drops to three.
    expect(mockFetch).toHaveBeenCalledTimes(4);
    expect(peak).toBe(4);
  });

  it('keeps charts that differ apart', async () => {
    await desugarExternals(
      {
        name: 'docx',
        props: {},
        children: [
          { name: 'highcharts', props: chartProps([1, 2, 3]) },
          { name: 'highcharts', props: chartProps([3, 2, 1]) },
          { name: 'highcharts', props: chartProps([1, 2, 3]) },
        ],
      },
      { theme: createMockTheme() }
    );

    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('renders the same chart again when it is placed at a different width', async () => {
    // The key is the resolved request body, and the body carries type sized
    // for the width the image is placed at — so the same series shrunk into
    // half the measure is a genuinely different PNG, not a cache miss to fix.
    const document = await desugarExternals(
      {
        name: 'docx',
        props: {},
        children: [
          { name: 'highcharts', props: chartProps([1, 2, 3]) },
          {
            name: 'highcharts',
            props: { ...chartProps([1, 2, 3]), width: 200 },
          },
        ],
      },
      { theme: createMockTheme() }
    );

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(document.children[0].props).toMatchObject({ width: 400 });
    expect(document.children[1].props).toMatchObject({ width: 200 });
  });

  it('does not carry a render across documents', async () => {
    const document = {
      name: 'docx',
      props: {},
      children: [{ name: 'highcharts', props: chartProps([1, 2, 3]) }],
    };

    await desugarExternals(document, { theme: createMockTheme() });
    await desugarExternals(document, { theme: createMockTheme() });

    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});

describe('chart work the host can see', () => {
  const chartProps = (data: number[]): Record<string, unknown> => ({
    options: {
      chart: { width: 400, height: 300 },
      series: [{ type: 'column', data }],
    },
  });

  beforeEach(() => {
    vi.clearAllMocks();
    resetChartLimiters();
    resetChartRequestStats();
    mockFetch.mockResolvedValue({ ok: true, text: async () => 'AA==' });
  });

  it('counts what a document asked for and what actually went out', async () => {
    await desugarExternals(
      {
        name: 'docx',
        props: {},
        children: [
          { name: 'highcharts', props: chartProps([1, 2, 3]) },
          { name: 'highcharts', props: chartProps([1, 2, 3]) },
          { name: 'highcharts', props: chartProps([3, 2, 1]) },
        ],
      },
      { theme: createMockTheme() }
    );

    expect(getChartRequestStats()).toMatchObject({
      collected: 3,
      unique: 2,
      retries: 0,
    });
  });

  it('shows the export server saturating at the cap', async () => {
    mockFetch.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      return { ok: true, text: async () => 'AA==' };
    });

    await desugarExternals(
      {
        name: 'docx',
        props: {},
        children: Array.from({ length: 20 }, (_, index) => ({
          name: 'highcharts',
          props: chartProps([index, index + 1]),
        })),
      },
      { theme: createMockTheme() }
    );

    expect(getChartRequestStats().maxInFlight).toBe(4);
  });

  it('counts the retries a struggling server cost', async () => {
    mockFetch
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockResolvedValue({ ok: true, text: async () => 'AA==' });

    await renderChartToImageProps(
      chartProps([1, 2, 3]) as never,
      createMockTheme()
    );

    expect(getChartRequestStats().retries).toBe(2);
  });
});

describe('saying once where the chart data went', () => {
  const remote = { serverUrl: 'https://charts.example.com', allowRemote: true };
  const chartProps = (data: number[]): Record<string, unknown> => ({
    options: {
      chart: { width: 400, height: 300 },
      series: [{ type: 'column', data }],
    },
  });

  beforeEach(() => {
    vi.clearAllMocks();
    resetChartLimiters();
    mockFetch.mockResolvedValue({ ok: true, text: async () => 'AA==' });
  });

  it('reports one notice for a document of charts on one remote server', async () => {
    const warnings: GenerationWarning[] = [];

    await desugarExternals(
      {
        name: 'docx',
        props: {},
        children: Array.from({ length: 10 }, (_, index) => ({
          name: 'highcharts',
          props: chartProps([index, index + 1]),
        })),
      },
      { theme: createMockTheme(), services: { highcharts: remote }, warnings }
    );

    expect(warnings).toHaveLength(1);
    expect(warnings[0].context).toEqual({
      code: 'W_HIGHCHARTS_REMOTE_EXPORT',
      serverUrl: 'https://charts.example.com',
    });
  });

  it('still names every remote server the document reached', async () => {
    const warnings: GenerationWarning[] = [];

    await desugarExternals(
      {
        name: 'docx',
        props: {},
        children: [
          {
            name: 'highcharts',
            props: {
              ...chartProps([1, 2]),
              serverUrl: 'https://a.example.com',
            },
          },
          {
            name: 'highcharts',
            props: {
              ...chartProps([2, 1]),
              serverUrl: 'https://b.example.com',
            },
          },
          {
            name: 'highcharts',
            props: {
              ...chartProps([3, 4]),
              serverUrl: 'https://a.example.com',
            },
          },
        ],
      },
      {
        theme: createMockTheme(),
        services: { highcharts: { allowRemote: true } },
        warnings,
      }
    );

    expect(warnings.map((w) => w.context?.serverUrl)).toEqual([
      'https://a.example.com',
      'https://b.example.com',
    ]);
  });
});
