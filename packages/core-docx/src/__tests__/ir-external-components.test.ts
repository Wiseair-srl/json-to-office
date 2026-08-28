/**
 * `visual` and `highcharts` end to end.
 *
 * Neither can be in the golden corpus: one needs LibreOffice and the other an
 * export server, so a recorded hash would depend on the machine that recorded
 * it. With the service stubbed to return fixed pixels the rest is checkable —
 * that a document holding one builds, that identical visuals are rasterized
 * once and embedded once, and that a visual is found wherever it hides.
 */

import { describe, expect, it, vi } from 'vitest';
import JSZip from 'jszip';
import { generateBufferFromJson } from '../core/generator';

/** A real, decodable 1×1 PNG, so image measurement has something to read. */
const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

/** The image parts of a package, which all live under `word/media/`. */
async function mediaParts(buffer: Buffer): Promise<string[]> {
  const zip = await JSZip.loadAsync(buffer);
  return Object.values(zip.files)
    .filter((file) => !file.dir && file.name.startsWith('word/media/'))
    .map((file) => file.name);
}

const visual = (text: string) => ({
  name: 'visual',
  props: {
    canvas: { width: 4, height: 2 },
    elements: [{ name: 'text', props: { text, x: 1, y: 1, w: 2, h: 0.5 } }],
  },
});

function pptxService() {
  return {
    render: vi.fn(async () => ({
      base64DataUri: PNG,
      width: 1,
      height: 1,
    })),
  };
}

describe('visual components', () => {
  it('embeds one image per distinct visual, however many times it appears', async () => {
    const service = pptxService();
    const buffer = await generateBufferFromJson(
      {
        name: 'docx',
        props: { title: 'Visuals' },
        children: [
          { name: 'paragraph', props: { text: 'Before.' } },
          visual('one'),
          visual('two'),
          // A duplicate must not rasterize twice, and must embed once.
          visual('one'),
          { name: 'paragraph', props: { text: 'After.' } },
        ],
      } as never,
      { validation: { enabled: false }, services: { pptx: service } }
    );

    expect(service.render).toHaveBeenCalledTimes(2);
    // Both visuals rasterize to the same stub PNG, so one part covers them.
    expect(await mediaParts(buffer)).toHaveLength(1);
  }, 60_000);

  it('finds a visual inside a table cell', async () => {
    const service = pptxService();
    await generateBufferFromJson(
      {
        name: 'docx',
        props: {},
        children: [
          {
            name: 'table',
            props: {
              columns: [
                {
                  header: { content: 'Chart' },
                  cells: [{ content: visual('in a cell') }],
                },
              ],
            },
          },
        ],
      } as never,
      { validation: { enabled: false }, services: { pptx: service } }
    );

    expect(service.render).toHaveBeenCalledOnce();
  }, 60_000);

  it('finds a visual inside a section header', async () => {
    const service = pptxService();
    await generateBufferFromJson(
      {
        name: 'docx',
        props: {},
        children: [
          {
            name: 'section',
            props: { header: [visual('in a header')] },
            children: [{ name: 'paragraph', props: { text: 'Body.' } }],
          },
        ],
      } as never,
      { validation: { enabled: false }, services: { pptx: service } }
    );

    expect(service.render).toHaveBeenCalledOnce();
  }, 60_000);
});

describe('highcharts components', () => {
  const chartDocument = {
    name: 'docx',
    props: { title: 'Charts' },
    children: [
      { name: 'paragraph', props: { text: 'Before.' } },
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
  };

  function stubExportServer(): void {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        text: async () => PNG.replace('data:image/png;base64,', ''),
      }))
    );
  }

  it('embeds the chart it exported', async () => {
    stubExportServer();
    const buffer = await generateBufferFromJson(chartDocument as never, {
      validation: { enabled: false },
    });

    vi.unstubAllGlobals();
    expect(await mediaParts(buffer)).toHaveLength(1);
  }, 60_000);
});
