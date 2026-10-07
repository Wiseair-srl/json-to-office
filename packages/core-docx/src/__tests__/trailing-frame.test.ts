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
 * final text frame.
 *
 * An earlier section ending on a frame needs one too. docx 9.9.0 writes a
 * section's properties into its last paragraph (dolanmiu/docx#3714), and in a
 * framed one LibreOffice draws the frame at the top left of the page and moves
 * every page after it: 101 paragraphs across five gallery templates. On
 * docx.js every such section gets the one-point paragraph, which takes the
 * bookmark end and the properties. `office-open` puts a closing bookmark end
 * between the frame and the properties, so it needs the paragraph only where
 * no bookmark closes.
 */

import { describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import JSZip from 'jszip';
import { generateBufferViaIr } from '../core/generateFromIr';
import type { DocxRendererId } from '../renderers/types';
import { CORPUS } from './fixtures/corpus';
import { PNG_4X2 } from './fixtures/corpus-blocks';
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

  it("keeps an earlier section's properties out of its last frame", async () => {
    const xml = await documentXml(
      await generate(report([backCover, closing]), renderer)
    );
    expect(framedSectionProperties(xml)).toBe(0);
    expect(after(xml, 'Closing section')).not.toMatch(ONE_POINT_PARAGRAPH);
    // docx.js closes the section in a one-point paragraph holding the bookmark
    // end and the properties; office-open in the paragraph after the bookmark
    // end, as it closes any bookmarked section.
    expect(after(xml, 'Charlie')).toMatch(
      renderer === 'docxjs'
        ? /^<w:p><w:pPr><w:spacing w:after="0" w:before="0" w:line="20" w:lineRule="exact"\/><w:sectPr>/
        : /^<w:bookmarkEnd w:id="\d+"\/><w:p><w:pPr><w:sectPr>/
    );
  });

  it('closes an unbookmarked run of frames in a one-point paragraph', async () => {
    // Blocks outside any section are a layout section with no bookmark.
    const xml = await documentXml(
      await generate(
        report([
          frame('Alpha', 922, 1440),
          frame('Charlie', 4046, 14500),
          closing,
        ]),
        renderer
      )
    );
    expect(framedSectionProperties(xml)).toBe(0);
    expect(after(xml, 'Charlie')).toMatch(
      /^<w:p><w:pPr><w:spacing w:after="0" w:before="0" w:line="20" w:lineRule="exact"\/><w:sectPr>/
    );
  });
});

/** Paragraphs whose properties hold both a frame and section properties. */
function framedSectionProperties(xml: string): number {
  return [...xml.matchAll(/<w:pPr>([\s\S]*?)<\/w:pPr>/g)].filter(
    ([, properties]) =>
      properties.includes('<w:framePr') && properties.includes('<w:sectPr')
  ).length;
}

const TEMPLATES_DIR = fileURLToPath(
  new URL('../../../jto/src/client/public/templates/', import.meta.url)
);

/** A `highcharts` needs an export server, which no test here has: an image. */
function chartsAsImages(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(chartsAsImages);
  if (typeof node !== 'object' || node === null) return node;
  if ((node as { name?: unknown }).name === 'highcharts')
    return { name: 'image', props: { base64: PNG_4X2, width: 320 } };
  return Object.fromEntries(
    Object.entries(node).map(([key, value]) => [key, chartsAsImages(value)])
  );
}

/**
 * Gallery templates that end sections on frames, or on blocks next to them.
 * `vermilion-annual-report` held 13 of the 101; the other four annual reports
 * hold the rest and take half a minute each to generate, so they are checked
 * with the release proof rather than on every run.
 */
const TEMPLATES = [
  'client-report-blocks',
  'technical-report-blocks',
  'vermilion-annual-report',
];

describe.each(RENDERERS)(
  'no section properties in a framed paragraph (%s)',
  (renderer) => {
    it.each(TEMPLATES)(
      'in the %s template',
      async (name) => {
        const document = chartsAsImages(
          JSON.parse(
            readFileSync(join(TEMPLATES_DIR, `${name}.docx.json`), 'utf8')
          )
        );
        const { buffer } = await generateBufferViaIr(document as never, {
          renderer,
          baseDir: TEMPLATES_DIR,
          // A `visual` that falls back to a picture is rasterized by a service.
          services: {
            pptx: {
              render: async () => ({
                base64DataUri: PNG_4X2,
                width: 4,
                height: 2,
              }),
            },
          },
        });
        expect(framedSectionProperties(await documentXml(buffer))).toBe(0);
      },
      120_000
    );

    it('in the corpus', async () => {
      let checked = 0;
      for (const testCase of CORPUS) {
        let buffer: Buffer;
        try {
          buffer = await generate(testCase.document, renderer);
        } catch (error) {
          // office-open refuses, by name, what it cannot express.
          if (
            (error as { code?: string }).code === 'UNSUPPORTED_RENDERER_FEATURE'
          )
            continue;
          throw error;
        }
        expect(
          framedSectionProperties(await documentXml(buffer)),
          testCase.name
        ).toBe(0);
        checked++;
      }
      expect(checked).toBeGreaterThan(250);
    }, 600_000);
  }
);

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
