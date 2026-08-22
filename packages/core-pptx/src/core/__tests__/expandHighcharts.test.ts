/**
 * Highcharts expansion — ported from the deleted component test
 * (`src/components/__tests__/highcharts.test.ts`).
 *
 * The `highcharts` component no longer renders itself onto a PptxGenJS slide.
 * It is expanded to an `image` component before compilation, so every
 * behaviour the old renderer owned — request shape, data URI, derived
 * dimensions, theme palette injection, error handling — is asserted here on
 * the component `expandHighchartsComponents` produces and on the request it
 * posts, instead of on a mock slide's `addImage` call. One end-to-end case
 * pins the PNG actually reaching the package.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import JSZip from 'jszip';
import { expandHighchartsComponents } from '../expandHighcharts';
import { generateBufferViaIr } from '../generateFromIr';
import type {
  PipelineWarning,
  PptxComponentInput,
  PptxThemeConfig,
  PresentationComponentDefinition,
  ProcessedPresentation,
} from '../../types';
import type { HighchartsServiceConfig } from '@json-to-office/shared';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const FAKE_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

/** The old test's `theme = {} as any`: no colors, so no palette injection. */
const EMPTY_THEME = {} as PptxThemeConfig;

function themeWith(colors: Record<string, string>): PptxThemeConfig {
  return {
    name: 'brand',
    colors: colors as PptxThemeConfig['colors'],
    fonts: { heading: 'Arial', body: 'Arial' },
    defaults: { fontSize: 18, fontColor: '#1A1A1A' },
  };
}

function presentation(
  components: PptxComponentInput[],
  theme: PptxThemeConfig
): ProcessedPresentation {
  return {
    metadata: {},
    theme,
    slideWidth: 10,
    slideHeight: 5.625,
    rtlMode: false,
    pageNumberFormat: '9',
    slides: [{ components }],
  };
}

interface ExpandResult {
  component: PptxComponentInput;
  unexpanded: Array<{ name: string; path: string }>;
  warnings: PipelineWarning[];
}

async function expand(
  props: Record<string, unknown>,
  theme: PptxThemeConfig = EMPTY_THEME,
  services?: HighchartsServiceConfig,
  warnings: PipelineWarning[] = []
): Promise<ExpandResult> {
  const result = await expandHighchartsComponents(
    presentation([{ name: 'highcharts', props }], theme),
    services,
    warnings
  );
  return {
    component: result.presentation.slides[0].components[0],
    unexpanded: result.unexpanded,
    warnings,
  };
}

interface ExportRequestBody {
  infile: Record<string, unknown> & { colors?: string[] };
  type: string;
  b64: boolean;
  scale?: number;
  resources?: { css?: string; js?: string; files?: string[] };
}

/** The URL and init of the first (and normally only) export-server call. */
function exportCall(): { url: string; init: RequestInit } {
  const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
  return { url, init };
}

function requestBody(): ExportRequestBody {
  return JSON.parse(exportCall().init.body as string) as ExportRequestBody;
}

const CHART_600x400 = { chart: { width: 600, height: 400 } };

describe('expandHighchartsComponents', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockResolvedValue({
      ok: true,
      text: vi.fn().mockResolvedValue(FAKE_B64),
    });
  });

  it('rewrites the component to an image with base64 data URI and derived dimensions', async () => {
    const { component } = await expand({
      options: { chart: { width: 960, height: 480 } },
    });

    expect(mockFetch).toHaveBeenCalledOnce();
    // The old renderer called `slide.addImage({ data, w, h })`; the same values
    // now live on the `image` component the expansion emits.
    expect(component).toEqual({
      name: 'image',
      props: {
        base64: `data:image/png;base64,${FAKE_B64}`,
        x: 0,
        y: 0,
        w: 10, // 960/96
        h: 5, // 480/96
      },
    });
  });

  it('uses explicit w/h when provided', async () => {
    const { component } = await expand({
      options: CHART_600x400,
      x: 1,
      y: 2,
      w: 8,
      h: 4,
    });

    expect(component.props).toMatchObject({ x: 1, y: 2, w: 8, h: 4 });
  });

  it('passes scale to export server', async () => {
    await expand({ options: CHART_600x400, scale: 2 });

    expect(requestBody().scale).toBe(2);
  });

  it('throws when export server unavailable', async () => {
    mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    await expect(expand({ options: CHART_600x400 })).rejects.toThrow(
      /not running.*enableServer/s
    );
  });

  it('throws on non-ok response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    });

    await expect(expand({ options: CHART_600x400 })).rejects.toThrow(
      /returned 500/
    );
  });

  it('uses custom serverUrl prop', async () => {
    await expand({
      options: CHART_600x400,
      serverUrl: 'http://custom-server:9999',
    });

    expect(mockFetch).toHaveBeenCalledWith(
      'http://custom-server:9999/export',
      expect.any(Object)
    );
  });

  it('uses services config serverUrl', async () => {
    await expand({ options: CHART_600x400 }, EMPTY_THEME, {
      serverUrl: 'http://services-server:5555',
    });

    expect(mockFetch).toHaveBeenCalledWith(
      'http://services-server:5555/export',
      expect.any(Object)
    );
  });

  it('prioritizes per-component serverUrl over services config', async () => {
    await expand(
      { options: CHART_600x400, serverUrl: 'http://prop-server:7777' },
      EMPTY_THEME,
      { serverUrl: 'http://services-server:5555' }
    );

    expect(mockFetch).toHaveBeenCalledWith(
      'http://prop-server:7777/export',
      expect.any(Object)
    );
  });

  it('falls back to the local export server when nothing configures a URL', async () => {
    await expand({ options: CHART_600x400 });

    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:7801/export',
      expect.any(Object)
    );
  });

  it('prefixes a scheme-less server URL', async () => {
    await expand({ options: CHART_600x400, serverUrl: 'charts.internal:7801' });

    expect(mockFetch).toHaveBeenCalledWith(
      'http://charts.internal:7801/export',
      expect.any(Object)
    );
  });

  it('merges services headers into fetch request', async () => {
    await expand({ options: CHART_600x400 }, EMPTY_THEME, {
      headers: { 'x-api-key': 'test-key-123' },
    });

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
    const headersFn = vi.fn((body: unknown) => ({
      'x-signature': `sig-${(body as ExportRequestBody).scale ?? 1}`,
    }));

    await expand({ options: CHART_600x400, scale: 3 }, EMPTY_THEME, {
      headers: headersFn,
    });

    expect(headersFn).toHaveBeenCalledOnce();
    expect(headersFn).toHaveBeenCalledWith(
      expect.objectContaining({
        infile: CHART_600x400,
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
    const headersFn = vi
      .fn()
      .mockResolvedValue({ authorization: 'Bearer async-token' });

    await expand({ options: CHART_600x400 }, EMPTY_THEME, {
      headers: headersFn,
    });

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
    await expand({ options: CHART_600x400 });

    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: { 'Content-Type': 'application/json' },
      })
    );
  });

  it('forwards resources verbatim to the export server when present', async () => {
    const resources = {
      css: "@font-face { font-family: 'Manrope'; src: url('https://cdn.example/manrope.woff2') format('woff2'); }",
      js: 'console.log("ready")',
      files: ['https://cdn.example/extra.css'],
    };

    await expand({
      options: {
        chart: { width: 600, height: 400, style: { fontFamily: 'Manrope' } },
      },
      resources,
    });

    // Forwarded verbatim, untransformed.
    expect(requestBody().resources).toEqual(resources);
  });

  it('omits resources from the request body when not provided', async () => {
    await expand({ options: CHART_600x400 });

    // Backward compatible: no resources key sent.
    expect('resources' in requestBody()).toBe(false);
  });

  it('reports a highcharts placeholder as unexpanded instead of rendering it', async () => {
    // Placeholder content is merged with its declaration during compilation, so
    // it cannot be rendered here at the right size. The old component layer had
    // no such seam — it rendered whatever it was handed.
    const result = await expandHighchartsComponents(
      {
        ...presentation([], EMPTY_THEME),
        slides: [
          {
            components: [],
            placeholders: {
              body: { name: 'highcharts', props: { options: CHART_600x400 } },
            },
          },
        ],
      },
      undefined,
      []
    );

    expect(result.unexpanded).toEqual([
      { name: 'highcharts', path: 'slides[0].placeholders.body' },
    ]);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  describe('theme palette injection', () => {
    const brandTheme = themeWith({
      primary: '#111111',
      secondary: '#222222',
      accent: '#CC785C',
      background: '#FFFFFF',
      text: '#1A1A1A',
    });

    it('injects the theme palette when options.colors is absent', async () => {
      await expand({ options: CHART_600x400 }, brandTheme);

      // accent4-6 are unset on this theme, so the palette stops at three
      // rather than repeating primary — same as DOCX.
      expect(requestBody().infile.colors).toEqual([
        '#111111',
        '#222222',
        '#CC785C',
      ]);
    });

    it('matches the DOCX palette for a theme that leaves accent4-6 unset', async () => {
      // Cross-format parity. The sibling DOCX test
      // "matches the PPTX palette for a theme that leaves accent4-6 unset"
      // (packages/core-docx/src/components/__tests__/highcharts.test.ts) posts
      // this exact array for the same three theme colors — package boundaries
      // keep the two renderers out of one test file, so the expectation is
      // pinned identically on both sides.
      await expand({ options: CHART_600x400 }, brandTheme);

      expect(requestBody().infile.colors).toEqual([
        '#111111',
        '#222222',
        '#CC785C',
      ]);
    });

    it('emits no THEME_COLOR_FALLBACK warning for unset accent slots', async () => {
      const { warnings } = await expand({ options: CHART_600x400 }, brandTheme);

      expect(warnings).toEqual([]);
    });

    it('keeps defined accent4-6 and compacts holes', async () => {
      await expand(
        { options: CHART_600x400 },
        themeWith({ ...brandTheme.colors, accent5: '#5555AA' })
      );

      // accent4 unset, accent5 defined: accent5 slides into the fourth slot,
      // matching the DOCX compaction documented on DEFAULT_CHART_THEME_COLORS.
      expect(requestBody().infile.colors).toEqual([
        '#111111',
        '#222222',
        '#CC785C',
        '#5555AA',
      ]);
    });

    // The theme schema lets one slot name another. These themes carry the same
    // three hexes as the DOCX `createMockTheme`, so each expectation below is
    // pinned byte-for-byte against its DOCX sibling in
    // packages/core-docx/src/components/__tests__/highcharts.test.ts.
    const chainedColors = {
      primary: '#0066cc',
      secondary: '#6c757d',
      accent: '#17a2b8',
      text: '#000000',
      background: '#FFFFFF',
    };

    it('resolves a token whose value names another token', async () => {
      // Sibling DOCX test of the same name posts '#0066CC' for accent4. PPTX
      // used to post the literal '#primary' — the export server drew it black.
      const { warnings } = await expand(
        { options: CHART_600x400 },
        themeWith({ ...chainedColors, accent4: 'primary' })
      );

      const { colors } = requestBody().infile;
      expect(colors).toEqual(['#0066cc', '#6c757d', '#17a2b8', '#0066CC']);
      expect(colors).not.toContain('#primary');
      expect(warnings).toEqual([]);
    });

    it('drops a token whose value resolves to nothing', async () => {
      await expand(
        { options: CHART_600x400 },
        themeWith({ ...chainedColors, accent4: 'notAThemeColor' })
      );

      // Same three-color palette the DOCX sibling emits for this theme.
      expect(requestBody().infile.colors).toEqual([
        '#0066cc',
        '#6c757d',
        '#17a2b8',
      ]);
    });

    it('drops tokens caught in a reference cycle', async () => {
      await expand(
        { options: CHART_600x400 },
        themeWith({ ...chainedColors, accent4: 'accent5', accent5: 'accent4' })
      );

      expect(requestBody().infile.colors).toEqual([
        '#0066cc',
        '#6c757d',
        '#17a2b8',
      ]);
    });

    it('leaves explicit options.colors untouched', async () => {
      await expand(
        { options: { ...CHART_600x400, colors: ['#ABCDEF'] } },
        brandTheme
      );

      expect(requestBody().infile.colors).toEqual(['#ABCDEF']);
    });

    it('skips injection when the theme has no colors', async () => {
      await expand({ options: CHART_600x400 }, EMPTY_THEME);

      expect('colors' in requestBody().infile).toBe(false);
    });
  });

  describe('end to end', () => {
    const deck = (
      props: Record<string, unknown>
    ): PresentationComponentDefinition =>
      ({
        name: 'pptx',
        props: { title: 'Highcharts' },
        children: [
          {
            name: 'slide',
            props: {},
            children: [{ name: 'highcharts', props }],
          },
        ],
      }) as PresentationComponentDefinition;

    it('places the exported PNG on the slide at the derived size', async () => {
      const { buffer } = await generateBufferViaIr(
        deck({ options: { chart: { width: 960, height: 480 } } })
      );

      const zip = await JSZip.loadAsync(buffer);
      const media = Object.values(zip.files)
        .filter((entry) => !entry.dir && entry.name.startsWith('ppt/media/'))
        .map((entry) => entry.name);
      expect(media).toHaveLength(1);
      expect(await zip.file(media[0])!.async('nodebuffer')).toEqual(
        Buffer.from(FAKE_B64, 'base64')
      );

      const slideXml = await zip.file('ppt/slides/slide1.xml')!.async('string');
      expect(slideXml).toContain('<p:pic>');
      // 10in x 5in in EMU (914400 per inch), i.e. the 960x480 chart at 96 dpi.
      expect(slideXml).toContain('<a:ext cx="9144000" cy="4572000"/>');
    });
  });
});
