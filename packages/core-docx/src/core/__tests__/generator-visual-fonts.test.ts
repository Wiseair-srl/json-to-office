import { describe, it, expect, vi, beforeEach } from 'vitest';

// Intercept renderDocument so we can inspect the options the generator built
// without producing an actual .docx.
const renderDocumentMock = vi.fn(async () => ({}) as any);
vi.mock('../render', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../render')>();
  return {
    ...actual,
    renderDocument: (...a: any[]) => renderDocumentMock(...a),
  };
});

import { generateDocument } from '../generator';
import type { ReportComponentDefinition } from '../../types';

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

const lastOptions = () => renderDocumentMock.mock.calls.at(-1)![2] as any;

beforeEach(() => {
  renderDocumentMock.mockClear();
});

describe('generator → renderDocument visualFonts', () => {
  it('passes non-empty visualFonts for a document with a visual and a custom font', async () => {
    await generateDocument(
      doc([
        { name: 'paragraph', props: { text: 'x', font: { family: 'Inter' } } },
        visualNode,
      ])
    );

    const options = lastOptions();
    expect(options.visualFonts).toBeDefined();
    expect(options.visualFonts.length).toBeGreaterThan(0);
    expect(options.visualFonts[0].family).toBe('Inter');
    // Wire shape: base64, no `data:` prefix, catalog family (not "Inter Light").
    expect(options.visualFonts[0].data).not.toMatch(/^data:/);
    expect(Buffer.from(options.visualFonts[0].data, 'base64').length).toBe(68);
  });

  it('passes NO visualFonts (and materializes nothing) without a visual', async () => {
    // Guards the force-materialize path from adding font I/O to every build.
    await generateDocument(
      doc([
        { name: 'paragraph', props: { text: 'x', font: { family: 'Inter' } } },
      ])
    );
    expect(lastOptions()).not.toHaveProperty('visualFonts');
  });

  it('passes no visualFonts when a visual-bearing doc has only safe fonts', async () => {
    await generateDocument({
      name: 'docx',
      props: {},
      children: [
        { name: 'paragraph', props: { text: 'x', font: { family: 'Arial' } } },
        visualNode,
      ],
    } as unknown as ReportComponentDefinition);
    expect(lastOptions()).not.toHaveProperty('visualFonts');
  });

  it('passes no visualFonts in substitute mode (every family is rewritten to a safe one)', async () => {
    await generateDocument(
      doc([
        { name: 'paragraph', props: { text: 'x', font: { family: 'Inter' } } },
        visualNode,
      ]),
      { fonts: { mode: 'substitute' } }
    );
    expect(lastOptions()).not.toHaveProperty('visualFonts');
  });
});
