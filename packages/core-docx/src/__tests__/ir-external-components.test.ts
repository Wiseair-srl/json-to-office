/**
 * `visual` and `highcharts` through the IR path.
 *
 * Neither can be in the golden corpus: one needs LibreOffice and the other an
 * export server, so a recorded hash would depend on the machine that recorded
 * it. What can be checked without either is that the desugaring pass produces
 * the same document the pre-IR writer does, with the service stubbed to return
 * fixed pixels — which is the only part of the two components this migration
 * changes.
 */

import { describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { generateBufferFromJson } from '../core/generator';
import { generateBufferViaIr } from '../core/generateFromIr';

/** A real, decodable 1×1 PNG, so image measurement has something to read. */
const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

function sha256(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
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

describe('visual components through DocxIR', () => {
  it('renders the same package as the pre-IR writer', async () => {
    const document = {
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
    };

    const legacy = (await generateBufferFromJson(document as never, {
      validation: { enabled: false },
      services: { pptx: pptxService() },
    })) as Buffer;

    const { buffer } = await generateBufferViaIr(document as never, {
      services: { pptx: pptxService() },
    });

    expect(sha256(buffer)).toBe(sha256(legacy));
  }, 30_000);

  it('rasterizes each distinct visual once', async () => {
    const service = pptxService();
    await generateBufferViaIr(
      {
        name: 'docx',
        props: {},
        children: [visual('one'), visual('two'), visual('one')],
      } as never,
      { services: { pptx: service } }
    );

    expect(service.render).toHaveBeenCalledTimes(2);
  }, 30_000);

  it('finds a visual inside a table cell', async () => {
    const service = pptxService();
    await generateBufferViaIr(
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
      { services: { pptx: service } }
    );

    expect(service.render).toHaveBeenCalledOnce();
  }, 30_000);
});

describe('highcharts components through DocxIR', () => {
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

  it('renders the same package as the pre-IR writer', async () => {
    stubExportServer();
    const legacy = (await generateBufferFromJson(chartDocument as never, {
      validation: { enabled: false },
    })) as Buffer;

    stubExportServer();
    const { buffer } = await generateBufferViaIr(chartDocument as never);

    vi.unstubAllGlobals();
    expect(sha256(buffer)).toBe(sha256(legacy));
  }, 30_000);
});
