/**
 * Can a real Office tool open what we produce?
 *
 * The tests below convert generated decks to PDF with LibreOffice, which is the
 * cheapest honest check that a package is not merely well-formed XML but
 * actually openable.
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
import type { PptxRendererId } from '../renderers/types';
import type { PresentationComponentDefinition } from '../types';

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

const PNG_4X2 =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAACCAYAAABytg0kAAAAFElEQVR42mNk+M9QzwAFjDAGACPuA/8fMSCgAAAAAElFTkSuQmCC';

const document = {
  name: 'pptx',
  props: { title: 'Smoke', author: 'JTO' },
  children: [
    {
      name: 'slide',
      props: { notes: 'speaker note' },
      children: [
        {
          name: 'text',
          props: {
            text: 'Opens in LibreOffice',
            x: 1,
            y: 0.8,
            w: 8,
            h: 1,
            fontSize: 28,
            bold: true,
            color: 'primary',
          },
        },
        {
          name: 'shape',
          props: {
            type: 'roundRect',
            x: 1,
            y: 2.2,
            w: 3,
            h: 1.4,
            fill: { color: 'accent' },
            line: { color: '333333', width: 2 },
          },
        },
        {
          name: 'image',
          props: { base64: PNG_4X2, x: 5, y: 2.2, w: 2, h: 1 },
        },
        {
          name: 'table',
          props: {
            rows: [
              ['Name', 'Value'],
              ['Alpha', '1'],
            ],
            x: 1,
            y: 4.2,
            w: 6,
          },
        },
      ],
    },
  ],
} as unknown as PresentationComponentDefinition;

describe.skipIf(!soffice)('LibreOffice can open the output', () => {
  it.each<[PptxRendererId]>([['pptxgenjs'], ['office-open']])(
    'converts a %s deck to PDF',
    async (renderer) => {
      const { buffer } = await generateBufferViaIr(
        structuredClone(document) as never,
        { renderer }
      );

      const dir = await mkdtemp(join(tmpdir(), 'jto-smoke-'));
      try {
        const input = join(dir, `${renderer}.pptx`);
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
