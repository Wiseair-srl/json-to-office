/**
 * Can a real Office tool open what we produce?
 *
 * Converting a generated document to PDF with LibreOffice is the cheapest
 * honest check that a package is not merely well-formed XML but actually
 * openable — which matters most for the second backend, where nothing else
 * proves the bytes are a document rather than a plausible-looking zip.
 *
 * The suite skips itself when LibreOffice is not on PATH, so nothing here makes
 * the test run depend on a GUI application being installed. Set
 * `JTO_REQUIRE_LIBREOFFICE=1` to turn a missing binary into a failure — CI can
 * use that where the tool is guaranteed.
 */

import { describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { generateBufferViaIr } from '../core/generateFromIr';
import type { DocxRendererId } from '../renderers/types';
import { findLibreOffice, requireIfInsisted } from './libreoffice';

const run = promisify(execFile);

const soffice = await findLibreOffice();
requireIfInsisted(Boolean(soffice), 'a LibreOffice binary on PATH');

/** A 4x2 PNG, so image measurement has real pixels to read. */
const PNG_4X2 =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAACCAYAAABytg0kAAAAFElEQVR42mNk+M9QzwAFjDAGACPuA/8fMSCgAAAAAElFTkSuQmCC';

const document = {
  name: 'docx',
  props: {
    theme: 'minimal',
    metadata: { title: 'Smoke', author: 'JTO' },
  },
  children: [
    { name: 'toc', props: {} },
    { name: 'heading', props: { level: 1, text: 'Opens in **LibreOffice**' } },
    {
      name: 'paragraph',
      props: {
        text: 'Body with a [link](https://example.com) and a note[^n].',
        footnotes: [{ id: 'n', text: 'The note body.' }],
        comment: { text: 'A review comment', author: 'Reviewer' },
      },
    },
    { name: 'list', props: { items: ['One', 'Two'], format: 'numbered' } },
    { name: 'image', props: { base64: PNG_4X2, width: '40%' } },
    {
      // A native shape, which is the one drawing kind that is not a picture.
      name: 'text-box',
      props: {
        renderAs: 'shape',
        width: 200,
        height: 80,
        text: 'In a shape',
        fill: 'f0f0f0',
      },
    },
    {
      name: 'table',
      props: {
        columns: [
          { header: { content: 'Name' }, cells: [{ content: 'Alpha' }] },
          { header: { content: 'Value' }, cells: [{ content: '1' }] },
        ],
      },
    },
    {
      name: 'section',
      props: { header: [{ name: 'paragraph', props: { text: 'Header' } }] },
      children: [{ name: 'paragraph', props: { text: 'Second section.' } }],
    },
  ],
};

/**
 * A native drawing group, which only the second backend can draw.
 *
 * Separate from the document above because `docxjs` refuses it by design, and
 * because it is the one construct whose whole point is that it is *not* a
 * picture: if a group were malformed, nothing short of opening the file would
 * say so.
 */
const nativeVisualDocument = {
  name: 'docx',
  renderer: 'office-open',
  props: { theme: 'minimal' },
  children: [
    { name: 'paragraph', props: { text: 'Before the drawing.' } },
    {
      name: 'visual',
      props: {
        renderMode: 'native',
        caption: 'Figure 1. A native drawing group.',
        alt: 'A rounded rectangle beside a label',
        canvas: { width: 5, height: 2.5, background: { color: '#F5F7FA' } },
        elements: [
          {
            name: 'shape',
            props: {
              type: 'roundRect',
              x: 0.25,
              y: 0.25,
              w: 2,
              h: 1,
              fill: { color: '#0F172A' },
              line: { color: '#334155', width: 1.5, dashType: 'dash' },
              text: 'In a shape',
              fontColor: '#FFFFFF',
            },
          },
          {
            name: 'text',
            props: {
              text: 'Editable Word content',
              x: 2.5,
              y: 0.4,
              w: 2.25,
              h: 0.5,
              fontSize: 16,
              bold: true,
            },
          },
          {
            name: 'image',
            props: { base64: PNG_4X2, x: 0.25, y: 1.5, w: 1, h: 0.5 },
          },
        ],
      },
    },
    { name: 'paragraph', props: { text: 'After the drawing.' } },
  ],
};

async function convertsToPdf(
  documentToRender: unknown,
  renderer: DocxRendererId,
  label: string
): Promise<void> {
  const { buffer } = await generateBufferViaIr(
    structuredClone(documentToRender) as never,
    { renderer }
  );

  const dir = await mkdtemp(join(tmpdir(), 'jto-docx-smoke-'));
  try {
    const input = join(dir, `${label}.docx`);
    await writeFile(input, buffer);

    await run(
      soffice as string,
      ['--headless', '--convert-to', 'pdf', '--outdir', dir, input],
      { timeout: 180_000 }
    );

    const produced = (await readdir(dir)).filter((name) =>
      name.endsWith('.pdf')
    );
    expect(produced).toEqual([`${label}.pdf`]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe.skipIf(!soffice)('LibreOffice can open the output', () => {
  it.each<[DocxRendererId]>([['docxjs'], ['office-open']])(
    'converts a %s document to PDF',
    async (renderer) => {
      await convertsToPdf(document, renderer, renderer);
    },
    240_000
  );

  it('converts a native drawing group to PDF', async () => {
    await convertsToPdf(nativeVisualDocument, 'office-open', 'native-visual');
  }, 240_000);
});
