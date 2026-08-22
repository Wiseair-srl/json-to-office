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

const run = promisify(execFile);

async function findLibreOffice(): Promise<string | undefined> {
  const candidates = [
    'soffice',
    '/Applications/LibreOffice.app/Contents/MacOS/soffice',
    '/usr/bin/soffice',
    '/usr/bin/libreoffice',
  ];
  for (const candidate of candidates) {
    try {
      await run(candidate, ['--version'], { timeout: 60_000 });
      return candidate;
    } catch {
      // Try the next candidate.
    }
  }
  return undefined;
}

const soffice = await findLibreOffice();
const required = process.env.JTO_REQUIRE_LIBREOFFICE === '1';

if (!soffice && required) {
  throw new Error(
    'JTO_REQUIRE_LIBREOFFICE=1 but no LibreOffice binary was found on PATH.'
  );
}

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

describe.skipIf(!soffice)('LibreOffice can open the output', () => {
  it.each<[DocxRendererId]>([['docxjs'], ['office-open']])(
    'converts a %s document to PDF',
    async (renderer) => {
      const { buffer } = await generateBufferViaIr(
        structuredClone(document) as never,
        { renderer }
      );

      const dir = await mkdtemp(join(tmpdir(), 'jto-docx-smoke-'));
      try {
        const input = join(dir, `${renderer}.docx`);
        await writeFile(input, buffer);

        await run(
          soffice as string,
          ['--headless', '--convert-to', 'pdf', '--outdir', dir, input],
          { timeout: 180_000 }
        );

        const produced = (await readdir(dir)).filter((name) =>
          name.endsWith('.pdf')
        );
        expect(produced).toEqual([`${renderer}.pdf`]);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
    240_000
  );
});
