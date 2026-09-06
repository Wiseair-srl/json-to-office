/**
 * The report's architecture — `cover`, `section-opener` and `running-head`
 * from the playground template — proven end to end: bounded slots reported as
 * coded issues, a cover and three openers under one running head generated
 * warning-clean on every bundled theme with the tracker following each
 * opener, and the same report rendered through LibreOffice so the tracker
 * and the `n / N` field are read off every page rather than out of the XML.
 *
 * The rendered part skips itself when LibreOffice is not on PATH;
 * `JTO_REQUIRE_LIBREOFFICE=1` turns that into a failure.
 */
import { describe, it, expect } from 'vitest';
import AdmZip from 'adm-zip';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { validateDocument } from '@json-to-office/shared-docx';
import { generateBufferWithWarnings } from '../../core/generator';
import { analyzeDocxQuality } from '../../quality/preflight';
import { expandBlocks } from '../index';
import { consultingTheme } from '../../styles';
import { block, example, on, para, section } from './example';
import {
  findLibreOffice,
  hasPdftotext,
  requireIfInsisted,
} from '../../__tests__/libreoffice';

const run = promisify(execFile);

const THEMES = ['consulting', 'minimal', 'vermilion', 'devportal'] as const;
type Theme = (typeof THEMES)[number];

// Trackers that occur nowhere in the openers or the body, so a rendered page
// that shows one can only have taken it from its header.
const TRACKERS = ['Year in brief', 'Regional picture', 'Twelve months on'];

/** A cover in its own section, then three sections under one running head. */
const report = (theme: Theme) => {
  const doc = example();
  doc.props.theme = theme;
  doc.props.metadata = { title: 'Annual review', author: 'JTO' };
  doc.children = [
    section(
      block('cover', {
        title: 'Growth improved as delivery became more reliable',
        subtitle: 'Annual performance review',
        client: 'Acme Holdings',
        date: 'September 2026',
        confidentiality: 'Confidential',
      })
    ),
    section(
      block('running-head', {
        confidentiality: 'Confidential',
        date: 'September 2026',
      }),
      block('section-opener', {
        number: '01',
        title: 'The year in one page',
        tracker: TRACKERS[0],
      }),
      para('Summary body.')
    ),
    section(
      block('section-opener', {
        number: '02',
        title: 'Results by region',
        tracker: TRACKERS[1],
      }),
      para('Results body.')
    ),
    section(
      block('section-opener', {
        number: '03',
        title: 'What to do next year',
        tracker: TRACKERS[2],
      }),
      para('Outlook body.')
    ),
  ];
  return doc;
};

const text = (xml: string) =>
  xml
    .replace(/<w:tab\/>/g, '\t')
    .replace(/<[^>]+>/g, '')
    .trim();

/** The header and footer text of each section, in document order. */
const chrome = (buffer: Buffer) => {
  const zip = new AdmZip(buffer);
  const main = zip.readAsText('word/document.xml');
  const rels = zip.readAsText('word/_rels/document.xml.rels');
  const target = (id: string) =>
    rels.match(new RegExp(`Id="${id}"[^>]*Target="([^"]+)"`))?.[1] ??
    rels.match(new RegExp(`Target="([^"]+)"[^>]*Id="${id}"`))?.[1];
  const part = (kind: 'header' | 'footer', sectPr: string) => {
    const id = sectPr.match(
      new RegExp(`<w:${kind}Reference[^>]*w:type="default"[^>]*r:id="([^"]+)"`)
    )?.[1];
    return id ? text(zip.readAsText(`word/${target(id)}`)) : undefined;
  };
  return [...main.matchAll(/<w:sectPr[\s>][\s\S]*?<\/w:sectPr>/g)].map(
    ([sectPr]) => ({
      type: sectPr.match(/<w:type w:val="([^"]+)"/)?.[1],
      header: part('header', sectPr),
      footer: part('footer', sectPr),
    })
  );
};

describe('the report architecture blocks', () => {
  it('bounds every chrome slot and reports a violation as a coded issue at the slot', () => {
    const doc = on(
      'consulting',
      block('cover', {
        subtitle: 'word '.repeat(31).trim(),
        logo: 'not a component',
      }),
      block('running-head', {
        pageNumbers: 'yes',
        tracker: 'one two three four five six seven',
      }),
      block('section-opener', { number: 'one two three four' })
    );
    const at = (path: string, code: string) =>
      expect.objectContaining({ code, path });
    const cover = '/children/0/children/0/props/slots';
    const head = '/children/0/children/1/props/slots';
    const opener = '/children/0/children/2/props/slots';
    expect(validateDocument(doc).errors).toEqual(
      expect.arrayContaining([
        at(`${cover}/title`, 'block_required_slot'),
        at(`${cover}/subtitle`, 'block_slot_budget'),
        at(`${cover}/logo`, 'block_slot_type'),
        at(`${head}/pageNumbers`, 'block_slot_type'),
        at(`${head}/tracker`, 'block_slot_budget'),
        at(`${opener}/title`, 'block_required_slot'),
        at(`${opener}/number`, 'block_slot_budget'),
      ])
    );
  });

  it('lets an opener without a tracker fall back to its title', () => {
    const doc = report('consulting');
    delete doc.children[2].children[0].props.slots.tracker;
    const expanded = expandBlocks(doc, consultingTheme);
    expect(expanded.document.children[2].props.header[0].props.text).toBe(
      'Annual review\tResults by region'
    );
  });

  describe.each(THEMES)('on the %s theme', (theme) => {
    it('generates a cover and three openers under one running head, warning-clean, the tracker following each opener', async () => {
      const doc = report(theme);
      expect(validateDocument(doc).errors).toEqual([]);
      const { buffer, warnings } = await generateBufferWithWarnings(doc);
      expect(warnings).toEqual([]);
      expect(
        analyzeDocxQuality(doc).diagnostics.filter(
          (finding) => finding.severity !== 'info'
        )
      ).toEqual([]);
      const sections = chrome(buffer as Buffer);
      expect(sections).toHaveLength(4);
      expect(sections[0]).toMatchObject({
        header: undefined,
        footer: undefined,
      });
      expect(sections.slice(1).map((s) => s.header)).toEqual(
        TRACKERS.map((tracker) => `Annual review\t${tracker}`)
      );
      for (const { footer } of sections.slice(1)) {
        expect(footer).toMatch(
          /^Confidential\t.*\bPAGE\b.*\/.*\bNUMPAGES\b.*\tSeptember 2026$/s
        );
      }
      // A header belongs to the page a section starts on, so every section
      // under the running head starts a new page.
      expect(sections.slice(1).map((s) => s.type)).toEqual(
        TRACKERS.map(() => 'nextPage')
      );
    });
  });
});

const soffice = await findLibreOffice();
const pdftotext = await hasPdftotext();
requireIfInsisted(Boolean(soffice), 'a LibreOffice binary on PATH');
requireIfInsisted(pdftotext, 'pdftotext');

describe.skipIf(!soffice || !pdftotext)('rendered through LibreOffice', () => {
  it('paints each section’s tracker and n / N on its own page, on every theme, and nothing on the cover', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'jto-report-chrome-'));
    try {
      for (const theme of THEMES) {
        const { buffer } = await generateBufferWithWarnings(report(theme));
        await writeFile(join(dir, `${theme}.docx`), buffer);
      }
      await run(
        soffice as string,
        [
          `-env:UserInstallation=file://${join(dir, 'profile').replace(/\\/g, '/')}`,
          '--headless',
          '--convert-to',
          'pdf',
          '--outdir',
          dir,
          ...THEMES.map((theme) => join(dir, `${theme}.docx`)),
        ],
        { timeout: 240_000 }
      );
      for (const theme of THEMES) {
        const txt = join(dir, `${theme}.txt`);
        await run('pdftotext', [join(dir, `${theme}.pdf`), txt]);
        const pages = (await readFile(txt, 'utf8'))
          .replace(/\f$/, '')
          .split('\f');
        expect(pages, theme).toHaveLength(4);
        const [cover, ...body] = pages;
        expect(cover, theme).toContain('Growth improved');
        expect(cover, theme).not.toContain('Annual review');
        expect(cover, theme).not.toMatch(/\d\s*\/\s*\d/);
        body.forEach((page, i) => {
          const label = `${theme} page ${i + 2}`;
          expect(page, label).toContain('Annual review');
          expect(page, label).toContain('Confidential');
          expect(page, label).toContain('September 2026');
          expect(page, label).toContain(TRACKERS[i]);
          expect(page, label).toMatch(new RegExp(`\\b${i + 2}\\s*/\\s*4\\b`));
          for (const other of TRACKERS.filter((t) => t !== TRACKERS[i]))
            expect(page, label).not.toContain(other);
        });
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 300_000);
});
