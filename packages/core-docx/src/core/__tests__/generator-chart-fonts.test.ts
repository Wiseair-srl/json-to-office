/**
 * Which font faces reach the chart export server.
 *
 * A `highcharts` is drawn by a browser the export server runs, which can only
 * set the chart in a registered face if it is handed the bytes — so the
 * question is not whether the document resolved the font but whether the
 * export request carried it. The fetch stub here records exactly that, through
 * both entry paths, so the two cannot drift on it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { generateBufferFromJson } from '../generator';
import { createDocumentGenerator } from '../../plugin/createDocumentGenerator';
import type { ReportComponentDefinition } from '../../types';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

/** A 1×1 PNG, so the image the chart becomes has a size to read. */
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
      chart: { width: 600, height: 400 },
      series: [{ type: 'column', data: [1, 2, 3] }],
    },
  },
};

function doc(children: unknown[], body = 'Inter'): ReportComponentDefinition {
  return {
    name: 'docx',
    props: {
      fontRegistry,
      themeOverrides: { fonts: { body: { family: body } } },
    },
    children,
  } as unknown as ReportComponentDefinition;
}

/** The export request body of the last chart drawn. */
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
    (document: ReportComponentDefinition) =>
      generateBufferFromJson(document as never, {
        validation: { enabled: false },
      }),
  ],
  [
    'plugin',
    (document: ReportComponentDefinition) =>
      createDocumentGenerator({
        validation: { enabled: false },
      }).generateBuffer(document as never),
  ],
] as const)(
  'fonts reaching the chart export server (%s pipeline)',
  (_, build) => {
    it('inlines the registered body face the chart is set in', async () => {
      await build(doc([chart]));
      const body = lastRequest();
      expect(body.infile.chart.style.fontFamily).toBe('"Inter", sans-serif');
      expect(body.resources.css).toMatch(
        /^@font-face\{font-family:"Inter";font-weight:400;font-style:normal;src:url\(data:font\/ttf;base64,[A-Za-z0-9+/=]+\) format\("truetype"\)\}$/
      );
      expect(
        Buffer.from(
          /base64,([^)]+)\)/.exec(body.resources.css as string)![1],
          'base64'
        ).length
      ).toBe(68);
    });

    it('sends no resources when the chart is set in safe fonts only', async () => {
      await build(doc([chart], 'Arial'));
      expect(lastRequest()).not.toHaveProperty('resources');
    });

    it('materializes nothing without a chart', async () => {
      await build(
        doc([
          {
            name: 'paragraph',
            props: { text: 'x', font: { family: 'Inter' } },
          },
        ])
      );
      expect(mockFetch).not.toHaveBeenCalled();
    });
  }
);
