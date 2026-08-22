/**
 * Which font faces reach the visual rasterizer.
 *
 * A `visual` is drawn by an out-of-process LibreOffice, which can only use a
 * font it has been handed the bytes for — so the question is not whether the
 * document resolved a font but whether the rasterizer received it. The stub
 * rasterizer here records exactly that.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { generateBufferFromJson } from '../generator';
import type { ReportComponentDefinition } from '../../types';

/** A real, decodable 1×1 PNG, so image measurement has something to read. */
const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

const rasterize = vi.fn(async () => ({
  base64DataUri: PNG,
  width: 1,
  height: 1,
}));

const TTF = Buffer.concat([
  Buffer.from([0x00, 0x01, 0x00, 0x00]),
  Buffer.alloc(64),
]).toString('base64');

const fontRegistry = [
  {
    id: 'Inter',
    family: 'Inter',
    sources: [{ kind: 'data' as const, data: TTF, weight: 400 }],
  },
];

const visualNode = {
  name: 'visual',
  props: {
    canvas: { width: 4, height: 2 },
    elements: [
      {
        name: 'text',
        props: { text: 'hi', x: 0.5, y: 0.5, w: 3, h: 1, fontFace: 'Inter' },
      },
    ],
  },
};

function doc(children: unknown[]): ReportComponentDefinition {
  return {
    name: 'docx',
    props: { fontRegistry },
    children,
  } as unknown as ReportComponentDefinition;
}

/** The fonts handed to the rasterizer for the last visual it drew. */
const lastFonts = () =>
  (rasterize.mock.calls.at(-1)?.[0] as { fonts?: unknown[] } | undefined) ?? {};

async function build(
  document: ReportComponentDefinition,
  options?: Parameters<typeof generateBufferFromJson>[1]
): Promise<void> {
  await generateBufferFromJson(document as never, {
    validation: { enabled: false },
    ...options,
    services: { pptx: { render: rasterize } },
  });
}

beforeEach(() => {
  rasterize.mockClear();
});

describe('fonts reaching the visual rasterizer', () => {
  it('hands over the custom font a visual-bearing document resolved', async () => {
    await build(
      doc([
        { name: 'paragraph', props: { text: 'x', font: { family: 'Inter' } } },
        visualNode,
      ])
    );

    const fonts = lastFonts().fonts as
      | Array<{ family: string; data: string }>
      | undefined;
    expect(fonts).toBeDefined();
    expect(fonts!.length).toBeGreaterThan(0);
    expect(fonts![0].family).toBe('Inter');
    // Wire shape: base64, no `data:` prefix, catalog family (not "Inter Light").
    expect(fonts![0].data).not.toMatch(/^data:/);
    expect(Buffer.from(fonts![0].data, 'base64').length).toBe(68);
  });

  it('rasterizes nothing, and materializes nothing, without a visual', async () => {
    // Guards the force-materialize path from adding font I/O to every build.
    await build(
      doc([
        { name: 'paragraph', props: { text: 'x', font: { family: 'Inter' } } },
      ])
    );
    expect(rasterize).not.toHaveBeenCalled();
  });

  it('hands over no fonts when a visual-bearing doc has only safe ones', async () => {
    await build({
      name: 'docx',
      props: {},
      children: [
        { name: 'paragraph', props: { text: 'x', font: { family: 'Arial' } } },
        visualNode,
      ],
    } as unknown as ReportComponentDefinition);
    expect(lastFonts()).not.toHaveProperty('fonts');
  });

  it('hands over no fonts in substitute mode (every family becomes a safe one)', async () => {
    await build(
      doc([
        { name: 'paragraph', props: { text: 'x', font: { family: 'Inter' } } },
        visualNode,
      ]),
      { fonts: { mode: 'substitute' } }
    );
    expect(lastFonts()).not.toHaveProperty('fonts');
  });
});
