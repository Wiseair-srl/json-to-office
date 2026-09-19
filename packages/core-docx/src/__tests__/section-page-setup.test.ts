/**
 * A section that sets its own page.
 *
 * Two things follow from a section's `page` and both used to be read off the
 * theme instead. A continuous section break cannot change the paper size or
 * orientation — Word starts a new page regardless and LibreOffice keeps the
 * old size — so such a section has to start on a new page. And its content is
 * measured against its own text width: a table, an image or a chart at a
 * percentage width sized to the theme's page comes out too narrow (or too
 * wide) on the section's.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import JSZip from 'jszip';
import { generateBufferWithWarnings } from '../core/generator';
import type { GenerationWarning } from '@json-to-office/shared';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

/** A 1×1 PNG. */
const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

beforeEach(() => {
  mockFetch.mockReset();
  mockFetch.mockResolvedValue({
    ok: true,
    text: vi.fn().mockResolvedValue(PNG_B64),
  });
});

const EMU_PER_TWIP = 635;
/** Minimal theme: A4 with 1700-twip side margins. */
const A4_MEASURE = 11906 - 2 * 1700;
/** One pixel at 96 dpi, in EMU: an image's extent is rounded to pixels. */
const EMU_PER_PIXEL = 9525;
/** Letter with 0.75-inch side margins. */
const LETTER_MEASURE = 12240 - 2 * 1080;
const LETTER = { size: 'LETTER', margins: { left: 1080, right: 1080 } };

const paragraph = (text: string) => ({ name: 'paragraph', props: { text } });

const section = (children: unknown[], props: Record<string, unknown> = {}) => ({
  name: 'section',
  props,
  children,
});

function doc(children: unknown[]) {
  return { name: 'docx', props: { theme: 'minimal' }, children };
}

interface Built {
  xml: string;
  warnings: GenerationWarning[];
  /** Each `w:sectPr`, in document order. */
  sections: string[];
}

async function build(
  definition: unknown,
  renderer: 'docxjs' | 'office-open'
): Promise<Built> {
  const warnings: GenerationWarning[] = [];
  const { buffer } = await generateBufferWithWarnings(definition as never, {
    renderer,
    warnings,
  });
  const zip = await JSZip.loadAsync(buffer);
  const xml = await zip.file('word/document.xml')!.async('string');
  const sections = Array.from(
    xml.matchAll(/<w:sectPr\b[\s\S]*?<\/w:sectPr>/g)
  ).map((m) => m[0]);
  return { xml, warnings, sections };
}

const sectionType = (sectPr: string) =>
  /<w:type w:val="(\w+)"/.exec(sectPr)?.[1];

const forced = (warnings: GenerationWarning[]) =>
  warnings.filter((w) => w.context?.code === 'W_SECTION_PAGE_BREAK_FORCED');

/** The `w:tblW` of each table, as `[type, value]`. */
const tableWidths = (xml: string) =>
  Array.from(xml.matchAll(/<w:tblW\b[^>]*\/>/g)).map((m) => [
    /w:type="(\w+)"/.exec(m[0])![1],
    /w:w="([^"]+)"/.exec(m[0])![1],
  ]);

/** The drawn width, in EMU, of each inline or anchored drawing. */
const extents = (xml: string) =>
  Array.from(xml.matchAll(/<wp:extent cx="(\d+)"/g)).map((m) => Number(m[1]));

/** One A4-section drawing, then one Letter-section drawing, each full width. */
function expectMeasuredWidths(xml: string): void {
  const [a4, letter] = extents(xml);
  expect(Math.abs(a4 - A4_MEASURE * EMU_PER_TWIP)).toBeLessThan(EMU_PER_PIXEL);
  expect(Math.abs(letter - LETTER_MEASURE * EMU_PER_TWIP)).toBeLessThan(
    EMU_PER_PIXEL
  );
}

describe.each(['docxjs', 'office-open'] as const)(
  'section page setup (%s)',
  (renderer) => {
    it('starts a section on a new page when it changes the paper size', async () => {
      const { sections, warnings } = await build(
        doc([
          section([paragraph('A4')]),
          section([paragraph('Letter')], { pageBreak: false, page: LETTER }),
        ]),
        renderer
      );
      expect(sections).toHaveLength(2);
      expect(sections[1]).toContain('w:w="12240"');
      expect(sectionType(sections[1])).toBe('nextPage');
      expect(forced(warnings)).toHaveLength(1);
    });

    it('starts a section on a new page when it changes the orientation', async () => {
      const { sections, warnings } = await build(
        doc([
          section([paragraph('Portrait')]),
          section([paragraph('Landscape')], {
            pageBreak: false,
            page: { size: { width: 16838, height: 11906 } },
          }),
        ]),
        renderer
      );
      expect(sectionType(sections[1])).toBe('nextPage');
      expect(forced(warnings)).toHaveLength(1);
    });

    it('keeps a margins-only change continuous, and says nothing', async () => {
      const { sections, warnings } = await build(
        doc([
          section([paragraph('Wide')]),
          section([paragraph('Narrow')], {
            pageBreak: false,
            page: { margins: { left: 2880, right: 2880 } },
          }),
        ]),
        renderer
      );
      expect(sectionType(sections[1])).toBe('continuous');
      expect(forced(warnings)).toHaveLength(0);
    });

    it('does not warn when the section asks for the page break itself', async () => {
      const { sections, warnings } = await build(
        doc([
          section([paragraph('A4')]),
          section([paragraph('Letter')], { pageBreak: true, page: LETTER }),
        ]),
        renderer
      );
      expect(sectionType(sections[1])).toBe('nextPage');
      expect(forced(warnings)).toHaveLength(0);
    });

    it('sizes a table against the section’s text width', async () => {
      const table = {
        name: 'table',
        props: {
          columns: [
            {
              header: { content: 'A' },
              width: '50%',
              cells: [{ content: '1' }],
            },
            { header: { content: 'B' }, cells: [{ content: '2' }] },
          ],
        },
      };
      const { xml } = await build(
        doc([section([table]), section([table], { page: LETTER })]),
        renderer
      );
      expect(tableWidths(xml)).toEqual([
        ['dxa', String(A4_MEASURE)],
        ['dxa', String(LETTER_MEASURE)],
      ]);
    });

    it('sizes a percentage-wide image against the section’s text width', async () => {
      const image = {
        name: 'image',
        props: { base64: `data:image/png;base64,${PNG_B64}`, width: '100%' },
      };
      const { xml } = await build(
        doc([section([image]), section([image], { page: LETTER })]),
        renderer
      );
      expectMeasuredWidths(xml);
    });

    it('places and sets a chart at the section’s text width', async () => {
      const chart = {
        name: 'highcharts',
        props: {
          width: '100%',
          options: {
            chart: { type: 'column', width: 900, height: 460 },
            series: [{ type: 'column', data: [1, 2, 3] }],
          },
        },
      };
      const { xml } = await build(
        doc([section([chart]), section([chart], { page: LETTER })]),
        renderer
      );
      expectMeasuredWidths(xml);
      // The type is scaled to the placed width, so the wider Letter measure
      // posts a different body than the A4 one.
      const bodies = mockFetch.mock.calls.map(
        (call) => (call[1] as RequestInit).body as string
      );
      expect(new Set(bodies).size).toBe(2);
    });
  }
);
