/**
 * A document whose body ends on text frames.
 *
 * A floating paragraph is a text frame (`w:framePr`), placed on the page by its
 * own coordinates. When the body ends on two or more of them, in a section that
 * has its own header or footer, LibreOffice drops the frame of the one before
 * last and sets its text at the top of the page — the back cover of the
 * `modern-annual-report-3` gallery template lost its "Follow Us" label that
 * way. It went unseen while a section closed its bookmark in a bare paragraph
 * after its last block, and showed once that bookmark end moved into the last
 * paragraph (22cbcff6); the `office-open` backend, which closes bookmarks
 * between blocks, never had the paragraph at all.
 *
 * Both backends now end the body with a one-point exact paragraph after a
 * final text frame. An earlier section needs none: its section properties
 * close it in a paragraph of their own.
 */

import { describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import JSZip from 'jszip';
import { generateBufferViaIr } from '../core/generateFromIr';
import type { DocxRendererId } from '../renderers/types';
import {
  findLibreOffice,
  hasPdftotext,
  pdfWordBoxes,
  requireIfInsisted,
} from './libreoffice';

const run = promisify(execFile);

const RENDERERS: DocxRendererId[] = ['docxjs', 'office-open'];

/** A paragraph floated to page coordinates, in twips. */
const frame = (text: string, x: number, y: number) => ({
  name: 'paragraph',
  props: {
    text,
    floating: {
      horizontalPosition: { relative: 'page', offset: x },
      verticalPosition: { relative: 'page', offset: y },
      width: 2600,
      height: 240,
      wrap: { type: 'none' },
    },
  },
});

/** A back cover: nothing but frames, under its own (empty) header and footer. */
const backCover = {
  name: 'section',
  props: { header: [], footer: [] },
  children: [
    frame('Alpha', 922, 1440),
    frame('Bravo', 4032, 14000),
    frame('Charlie', 4046, 14500),
  ],
};

const closing = {
  name: 'section',
  props: { pageBreak: true },
  children: [{ name: 'paragraph', props: { text: 'Closing section' } }],
};

function report(children: unknown[]) {
  return { name: 'docx', props: { theme: 'minimal' }, children };
}

async function generate(
  document: unknown,
  renderer: DocxRendererId
): Promise<Buffer> {
  const { buffer } = await generateBufferViaIr(
    structuredClone(document) as never,
    { renderer }
  );
  return buffer;
}

async function documentXml(buffer: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  return zip.file('word/document.xml')!.async('string');
}

/** Everything the body holds after the paragraph that says `text`. */
function after(xml: string, text: string): string {
  const at = xml.indexOf(`>${text}</w:t>`);
  expect(at, text).toBeGreaterThan(-1);
  return xml.slice(xml.indexOf('</w:p>', at) + '</w:p>'.length);
}

const ONE_POINT_PARAGRAPH =
  /^<w:p><w:pPr><w:spacing w:after="0" w:before="0" w:line="20" w:lineRule="exact"\/><\/w:pPr>(?:<w:bookmarkEnd w:id="\d+"\/>)?<\/w:p>/;

describe.each(RENDERERS)('a body that ends on text frames (%s)', (renderer) => {
  it('places every frame by its own page coordinates', async () => {
    const xml = await documentXml(
      await generate(report([backCover]), renderer)
    );
    const frames = [...xml.matchAll(/<w:framePr ([^>]*)\/>/g)].map(
      ([, attributes]) =>
        Object.fromEntries(
          [...attributes.matchAll(/w:(\w+)="([^"]*)"/g)].map(([, k, v]) => [
            k,
            v,
          ])
        )
    );
    expect(frames).toEqual(
      [
        [922, 1440],
        [4032, 14000],
        [4046, 14500],
      ].map(([x, y]) =>
        expect.objectContaining({
          x: String(x),
          y: String(y),
          hAnchor: 'page',
          vAnchor: 'page',
        })
      )
    );
  });

  it('closes the document with a one-point paragraph after the last frame', async () => {
    const xml = await documentXml(
      await generate(report([backCover]), renderer)
    );
    const tail = after(xml, 'Charlie');
    expect(tail).toMatch(ONE_POINT_PARAGRAPH);
    // Nothing but that paragraph, the bookmark end and the section follow.
    expect(tail.replace(ONE_POINT_PARAGRAPH, '')).toMatch(
      /^(?:<w:bookmarkEnd w:id="\d+"\/>)?<w:sectPr>/
    );
  });

  it('adds nothing to an earlier section, which its properties close', async () => {
    const xml = await documentXml(
      await generate(report([backCover, closing]), renderer)
    );
    expect(after(xml, 'Charlie')).not.toMatch(ONE_POINT_PARAGRAPH);
    expect(after(xml, 'Closing section')).not.toMatch(ONE_POINT_PARAGRAPH);
  });
});

const soffice = await findLibreOffice();
const pdftotext = await hasPdftotext();
requireIfInsisted(Boolean(soffice) && pdftotext, 'LibreOffice and pdftotext');

describe.skipIf(!soffice || !pdftotext)(
  'LibreOffice keeps the frame before last where it was placed',
  () => {
    it.each(RENDERERS)(
      '%s',
      async (renderer) => {
        const dir = await mkdtemp(join(tmpdir(), 'jto-trailing-frame-'));
        try {
          const input = join(dir, 'back-cover.docx');
          await writeFile(input, await generate(report([backCover]), renderer));
          await run(
            soffice as string,
            ['--headless', '--convert-to', 'pdf', '--outdir', dir, input],
            { timeout: 180_000 }
          );
          const bbox = join(dir, 'back-cover.html');
          await run('pdftotext', ['-bbox', join(dir, 'back-cover.pdf'), bbox], {
            timeout: 60_000,
          });
          const [page] = pdfWordBoxes(await readFile(bbox, 'utf8'));
          const top = (text: string) =>
            page.find((word) => word.text === text)?.yMin;
          // 14000 and 14500 twips down the page: 700pt and 725pt. A dropped
          // frame sets its text in the body instead, near the top margin.
          expect(top('Bravo')).toBeGreaterThan(690);
          expect(top('Charlie')).toBeGreaterThan(715);
        } finally {
          await rm(dir, { recursive: true, force: true });
        }
      },
      240_000
    );
  }
);
