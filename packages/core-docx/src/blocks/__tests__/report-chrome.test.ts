/**
 * The report's architecture — `cover`, `section-opener` and `running-head`
 * from the playground template — proven end to end: bounded slots reported as
 * coded issues, a cover and three openers under one running head generated
 * warning-clean on every bundled theme with the title on every page after
 * the cover, and the same report rendered through LibreOffice so the header
 * and the `n / N` field are read off every page rather than out of the XML,
 * and the cover's floating band is found where its anchor puts it on both
 * renderers.
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
import type { DocxRendererId } from '../../renderers/types';
import { expandBlocks } from '../index';
import {
  consultingTheme,
  minimalTheme,
  vermilionTheme,
  devportalTheme,
} from '../../styles';
import { block, example, on, para, section } from './example';
import {
  findLibreOffice,
  hasPdftoppm,
  hasPdftotext,
  requireIfInsisted,
  pdfPageGray,
  pdfPageSizes,
  pdfWordBoxes,
  textRows,
} from '../../__tests__/libreoffice';

const run = promisify(execFile);

const THEMES = ['consulting', 'minimal', 'vermilion', 'devportal'] as const;
const RENDERERS: readonly DocxRendererId[] = ['docxjs', 'office-open'];
type Theme = (typeof THEMES)[number];
const THEME_CONFIG = {
  consulting: consultingTheme,
  minimal: minimalTheme,
  vermilion: vermilionTheme,
  devportal: devportalTheme,
} as const;

// Trackers that occur nowhere in the openers or the body, so a rendered page
// that shows one can only have taken it from its header.
const TRACKERS = ['Year in brief', 'Regional picture', 'Twelve months on'];

/** A cover in its own section, then three sections under one running head. */
const report = (theme: Theme, client = 'Acme Holdings') => {
  const doc = example();
  doc.props.theme = theme;
  doc.props.metadata = { title: 'Annual review', author: 'JTO' };
  doc.children = [
    section(
      block('cover', {
        title: 'Growth improved as delivery became more reliable',
        subtitle: 'Annual performance review',
        client,
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
      }),
      para('Summary body.')
    ),
    section(
      block('section-opener', {
        number: '02',
        title: 'Results by region',
      }),
      para('Results body.')
    ),
    section(
      block('section-opener', {
        number: '03',
        title: 'What to do next year',
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
        title: 'one two three four five six seven',
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
        at(`${head}/title`, 'block_slot_budget'),
        at(`${opener}/title`, 'block_required_slot'),
        at(`${opener}/number`, 'block_slot_budget'),
      ])
    );
  });

  // #410: the number opens the section, so the section's gap belongs above
  // it. Leaving the gap on the heading below put the number in the space
  // that separates the sections, where it read as a footnote to the one
  // that ended rather than the number of the one starting.
  it.each(THEMES)(
    'puts the section gap above the number and keeps the pair together on %s',
    (theme) => {
      const config = THEME_CONFIG[theme];
      const gap = config.styles?.heading1?.spacing?.before;
      expect(typeof gap, theme).toBe('number');
      const opener = (slots: Record<string, string>) =>
        (
          expandBlocks(on(theme, block('section-opener', slots)), config)
            .document as any
        ).children[0].children[0].children;

      const [number, heading] = opener({
        number: '01',
        title: 'The year in one page',
      });
      expect(number.name, theme).toBe('paragraph');
      expect(number.props.spacing, theme).toEqual({ before: gap, after: 0 });
      expect(number.props.keepNext, theme).toBe(true);
      expect(heading.name, theme).toBe('heading');
      expect(heading.props.spacing, theme).toEqual({ before: 0 });

      // Nothing above it to group with: an unnumbered opener keeps the
      // heading style's own gap rather than losing it to a number that is
      // not there.
      const [only] = opener({ title: 'The year in one page' });
      expect(only.name, theme).toBe('heading');
      expect(only.props.spacing, theme).toBeUndefined();
    }
  );

  describe.each(THEMES)('on the %s theme', (theme) => {
    it('generates a cover and three openers under one running head, warning-clean, the title on every section after the cover', async () => {
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
        TRACKERS.map(() => 'Annual review')
      );
      for (const { footer } of sections.slice(1)) {
        expect(footer).toMatch(
          /^Confidential\t.*\bPAGE\b.*\/.*\bNUMPAGES\b.*\tSeptember 2026$/s
        );
      }
      // The running head starts its section on a new page after the cover;
      // the sections that inherit it continue on the page.
      expect(sections[1].type).toBe('nextPage');
      expect(sections.slice(2).map((s) => s.type)).toEqual(
        TRACKERS.slice(1).map(() => 'continuous')
      );
    });
  });
});

const soffice = await findLibreOffice();
const pdftotext = await hasPdftotext();
const pdftoppm = await hasPdftoppm();
requireIfInsisted(Boolean(soffice), 'a LibreOffice binary on PATH');
requireIfInsisted(pdftotext, 'pdftotext');
requireIfInsisted(pdftoppm, 'pdftoppm');

/**
 * A client name at the slot's six-word budget, which wraps under its label
 * and so takes the band down towards the bottom margin.
 */
const WIDE_CLIENT = 'Acme Holdings International Group Services Limited';

/** The cover band's labels, and the value `report` fills in under each. */
const BAND = [
  ['Prepared', 'Acme'],
  ['Date', 'September'],
  ['Classification', 'Confidential'],
] as const;

/**
 * The cover band read off page 1 and checked where it stands: its labels in
 * the bottom fifth of the page, each flush with the value under it, and a
 * rule running across the band just above them; and no page of the document
 * left without text. Returns the top of the label row and the page count,
 * for the renderers to be compared on.
 */
async function coverBand(
  pdf: string,
  label: string
): Promise<{ top: number; pages: number }> {
  const xml = pdf.replace(/\.pdf$/, '.xml');
  await run('pdftotext', ['-bbox', pdf, xml]);
  const source = await readFile(xml, 'utf8');
  const pages = pdfWordBoxes(source);
  const [words] = pages;
  const [page] = pdfPageSizes(source);
  expect(
    pages.flatMap((onPage, index) => (onPage.length ? [] : [index + 1])),
    `${label}: pages with no text`
  ).toEqual([]);
  // The topmost match at or below `from`: the client's name is also the
  // eyebrow above the title, and the band's is the one under its label.
  const find = (text: string, from = 0) =>
    words
      .filter((w) => w.text.toLowerCase() === text.toLowerCase())
      .filter((w) => w.yMin >= from)
      .sort((a, b) => a.yMin - b.yMin)[0];
  const cells = BAND.map(([name, value]) => {
    const head = find(name);
    expect(head, `${label}: ${name}`).toBeDefined();
    const under = find(value, head!.yMin);
    expect(under, `${label}: ${value} under ${name}`).toBeDefined();
    return { head: head!, under: under! };
  });
  const top = Math.min(...cells.map((cell) => cell.head.yMin));
  expect(top, `${label}: the band at the foot`).toBeGreaterThan(
    page.height * 0.8
  );
  for (const { head, under } of cells)
    expect(
      Math.abs(head.xMin - under.xMin),
      `${label}: ${head.text} flush with ${under.text}`
    ).toBeLessThan(0.5);

  // A rule is not text, so it is looked for in pixels: the longest run of
  // ink along any row of the strip above the labels, against the width from
  // the first label to the end of the last value.
  const scale = 144 / 72;
  const gray = await pdfPageGray(pdf, 1, 144);
  const [left, right] = [
    Math.floor(cells[0].head.xMin * scale),
    Math.ceil(cells[2].under.xMax * scale),
  ];
  let longest = 0;
  for (let y = Math.floor((top - 14) * scale); y < top * scale; y++) {
    let inked = 0;
    for (let x = left; x < right; x++) {
      inked = gray.pixels[y * gray.width + x] < 245 ? inked + 1 : 0;
      longest = Math.max(longest, inked);
    }
  }
  expect(longest, `${label}: the band's top rule`).toBeGreaterThan(
    (right - left) * 0.95
  );
  return { top, pages: pages.length };
}

describe.skipIf(!soffice || !pdftotext)('rendered through LibreOffice', () => {
  it('paints the title and n / N on every page after the cover, with the sections flowing, on every theme', async () => {
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
        // Three one-paragraph sections share the page after the cover.
        expect(pages, theme).toHaveLength(2);
        const [cover, ...body] = pages;
        expect(cover, theme).toContain('Growth improved');
        expect(cover, theme).not.toContain('Annual review');
        expect(cover, theme).not.toMatch(/\d\s*\/\s*\d/);
        body.forEach((page, i) => {
          const label = `${theme} page ${i + 2}`;
          // The running head is painted in the theme's tracker role, which on
          // every extended theme sets `case: upper` — so the header is read
          // case-insensitively, and the case itself is asserted below.
          expect(page.toLowerCase(), label).toContain('annual review');
          expect(page, label).toContain('Confidential');
          expect(page, label).toContain('September 2026');
          // #361: the tracker role's `case` reaches the header. `minimal`
          // declares no roles, so its header keeps the authored case.
          expect(
            page.includes(
              THEME_CONFIG[theme].typography?.roles?.tracker?.case === 'upper'
                ? 'ANNUAL REVIEW'
                : 'Annual review'
            ),
            `${label}: tracker case`
          ).toBe(true);
          expect(page, label).toMatch(new RegExp(`\\b${i + 2}\\s*/\\s*2\\b`));
          // Letter-spaced display headings (vermilion) come out of pdftotext
          // with spaces inside words, so compare without whitespace.
          for (const title of [
            'The year in one page',
            'Results by region',
            'What to do next year',
          ])
            expect(page.replace(/\s+/g, ''), label).toContain(
              title.replace(/\s+/g, '')
            );
        });
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 300_000);

  // #410, measured rather than asserted about the XML: on the page, the
  // space that separates two sections has to be above the number, not
  // between the number and the heading it belongs to.
  it('sets each section number against its heading, with the section gap above the pair, on every theme', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'jto-opener-gap-'));
    try {
      // Four sections in one flow: short headings, one that wraps, and
      // enough body between the third and the fourth to carry the last
      // opener over a page break. So the pair is measured at a page top,
      // mid-page, over a heading of more than one line, and at a page
      // boundary — the case where the number could be stranded at the foot
      // of one page with its heading at the top of the next.
      const FILL = Array.from(
        { length: 52 },
        (_, i) => `Sentence ${i} carries the section on with several more words`
      ).join('. ');
      const flowing = (theme: Theme) => {
        const doc = example();
        doc.props.theme = theme;
        doc.children = [
          section(
            block('section-opener', { number: '01', title: 'The year' }),
            para('Summary body.'),
            block('section-opener', { number: '02', title: 'Results' }),
            para('Results body.'),
            block('section-opener', {
              number: '03',
              title:
                'What to do next year across every region and every function',
            }),
            para(FILL),
            para(FILL),
            block('section-opener', { number: '04', title: 'What comes next' }),
            para('Outlook body.')
          ),
        ];
        return doc;
      };
      for (const theme of THEMES) {
        const { buffer } = await generateBufferWithWarnings(flowing(theme));
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
        const xml = join(dir, `${theme}.xml`);
        await run('pdftotext', ['-bbox', join(dir, `${theme}.pdf`), xml]);
        const pages = pdfWordBoxes(await readFile(xml, 'utf8')).map(textRows);
        expect(pages.length, `${theme}: pages`).toBeGreaterThan(1);
        const gap = THEME_CONFIG[theme].styles!.heading1!.spacing!.before!;
        const seen: string[] = [];
        pages.forEach((rows, pageIndex) => {
          const numbers = rows
            .map((row, i) => (/^0[1234]$/.test(row.text) ? i : -1))
            .filter((i) => i >= 0);
          for (const i of numbers) {
            const label = `${theme} ${rows[i].text} on page ${pageIndex + 1}`;
            seen.push(rows[i].text);
            // The heading is on this page too, right under the number: the
            // pair never straddles the break. What separates them is
            // leading, not the gap that separates two sections — and the
            // boxes may even overlap slightly, since a display heading's
            // line box reaches above its caps.
            expect(rows[i + 1], `${label}: the heading under it`).toBeDefined();
            const below = rows[i + 1].yMin - rows[i].yMax;
            expect(below, `${label}: below the number`).toBeLessThan(gap / 2);
            // And the section's own gap is above the number, so the number
            // opens its section instead of trailing the one that ended. A
            // number at the top of a page has no row above it to measure.
            if (i === 0) continue;
            const above = rows[i].yMin - rows[i - 1].yMax;
            expect(above, `${label}: above the number`).toBeGreaterThan(below);
            expect(above, `${label}: above the number`).toBeGreaterThanOrEqual(
              gap * 0.9
            );
          }
        });
        expect(seen, `${theme}: every opener`).toEqual([
          '01',
          '02',
          '03',
          '04',
        ]);
        // The fourth opener is the one carried over a page break.
        expect(
          pages[0].some((row) => row.text === '04'),
          `${theme}: the opener at the page boundary`
        ).toBe(false);
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 300_000);

  // #468. The cover band is a text box floated to the foot of the text area,
  // and what it holds ends on a table. `office-open` closed the box's cell on
  // that table, which Word tolerates and LibreOffice misreads: the band came
  // out in the flow under the subtitle, with no top rule and its first label
  // indented past its value. Floated where it belongs, a band that wraps its
  // client name reaches past the bottom margin, and with nothing between it
  // and the cover's section break LibreOffice gave the cover a second, empty
  // page. So the pages are read, on both renderers.
  it.skipIf(!pdftoppm)(
    'pins the cover band to the foot of the page under its rule, the same on both renderers, on every theme',
    async () => {
      const dir = await mkdtemp(join(tmpdir(), 'jto-cover-band-'));
      try {
        const names = THEMES.flatMap((theme) =>
          RENDERERS.map((renderer) => `${theme}-${renderer}`)
        );
        for (const theme of THEMES)
          for (const renderer of RENDERERS) {
            const { buffer } = await generateBufferWithWarnings(
              report(theme, WIDE_CLIENT),
              { renderer }
            );
            await writeFile(join(dir, `${theme}-${renderer}.docx`), buffer);
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
            ...names.map((name) => join(dir, `${name}.docx`)),
          ],
          { timeout: 240_000 }
        );
        for (const theme of THEMES) {
          const bands: Array<{ top: number; pages: number }> = [];
          for (const renderer of RENDERERS)
            bands.push(
              await coverBand(
                join(dir, `${theme}-${renderer}.pdf`),
                `${theme} on ${renderer}`
              )
            );
          expect(
            Math.abs(bands[0].top - bands[1].top),
            `${theme}: the band's height on each renderer`
          ).toBeLessThan(1);
          expect(bands[1].pages, `${theme}: pages on each renderer`).toBe(
            bands[0].pages
          );
        }
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
    300_000
  );
});
