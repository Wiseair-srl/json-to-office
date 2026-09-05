/**
 * Which font faces reach the chart export server.
 *
 * The PPTX itself never embeds font bytes, but a `highcharts` is drawn by a
 * browser the export server runs, which can only set the chart in a
 * registered face if the request carries the bytes. The fetch stub records
 * exactly that, through both entry paths, so the two cannot drift on it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { generateBufferFromJson } from '../generator';
import { createPresentationGenerator } from '../../plugin/createPresentationGenerator';
import type { PresentationComponentDefinition } from '../../types';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

const TTF = Buffer.concat([
  Buffer.from([0x00, 0x01, 0x00, 0x00]),
  Buffer.alloc(64),
]).toString('base64');

const fontRegistry = [
  {
    id: 'Inter',
    family: 'Inter',
    category: 'sans' as const,
    sources: [{ kind: 'data' as const, data: TTF, weight: 400 }],
  },
];

const chart = {
  name: 'highcharts',
  props: {
    options: {
      chart: { width: 960, height: 540 },
      series: [{ type: 'column', data: [1, 2, 3] }],
    },
    x: 1,
    y: 1,
    w: 8,
    h: 4.5,
  },
};

function deck(
  components: unknown[],
  body = 'Inter'
): PresentationComponentDefinition {
  return {
    name: 'pptx',
    props: {
      fontRegistry,
      theme: {
        name: 'brand',
        colors: {
          primary: '#111111',
          secondary: '#222222',
          accent: '#333333',
          background: '#FFFFFF',
          text: '#1A1F26',
        },
        fonts: { heading: 'Arial', body },
        defaults: { fontSize: 18, fontColor: '#1A1F26' },
      },
    },
    children: [{ name: 'slide', children: components }],
  } as unknown as PresentationComponentDefinition;
}

const lastRequest = () =>
  JSON.parse((mockFetch.mock.calls.at(-1)?.[1] as RequestInit).body as string);

beforeEach(() => {
  mockFetch.mockReset();
  mockFetch.mockResolvedValue({
    ok: true,
    text: vi.fn().mockResolvedValue(PNG_B64),
  });
});

describe.each([
  [
    'core',
    (document: PresentationComponentDefinition) =>
      generateBufferFromJson(document as never, {
        validation: { enabled: false },
      }),
  ],
  [
    'plugin',
    (document: PresentationComponentDefinition) =>
      createPresentationGenerator({
        validation: { enabled: false },
      }).generateBuffer(document as never),
  ],
] as const)(
  'fonts reaching the chart export server (%s pipeline)',
  (_, build) => {
    it('inlines the registered body face the chart is set in', async () => {
      await build(deck([chart]));
      const body = lastRequest();
      expect(body.infile.chart.style.fontFamily).toBe('"Inter", sans-serif');
      expect(body.resources.css).toMatch(
        /^@font-face\{font-family:"Inter";font-weight:400;font-style:normal;src:url\(data:font\/ttf;base64,[A-Za-z0-9+/=]+\) format\("truetype"\)\}$/
      );
    });

    it('sends no resources when the chart is set in safe fonts only', async () => {
      await build(deck([chart], 'Arial'));
      expect(lastRequest()).not.toHaveProperty('resources');
    });

    it('materializes nothing without a chart', async () => {
      await build(
        deck([
          {
            name: 'text',
            props: { text: 'x', fontFace: 'Inter', x: 1, y: 1, w: 4, h: 1 },
          },
        ])
      );
      expect(mockFetch).not.toHaveBeenCalled();
    });
  }
);
