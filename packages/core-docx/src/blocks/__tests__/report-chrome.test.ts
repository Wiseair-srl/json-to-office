/**
 * The report-architecture blocks — `cover`, `section-opener` and
 * `running-head` — from authored slots to rendered pages.
 *
 * What they promise is observable from outside: the primitives each lowers to
 * and where their values come from (the theme's recipes, never a constant of
 * their own); that a running head declared once reaches every later section
 * and its tracker follows each section's opener; that authored chrome always
 * wins; that findings inside the generated chrome are reported at the slot
 * that produced the text; and that both renderers draw the parts, page
 * fields and tab stops the recipe asks for. Everything here is asserted on
 * those.
 */
import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { validateStrict } from '@json-to-office/shared-docx';
import { blockSlotBudgets, expandBlocks, toAuthoredPointer } from '../index';
import { consultingTheme, minimalTheme } from '../../templates/themes';
import { resolveDocxDesignSystem } from '../../themes/design-system';
import { prepareDocxQualityDocument } from '../../quality/facts';
import { analyzeDocxQuality } from '../../quality/preflight';
import { compileDocumentToIr } from '../../core/generateFromIr';
import { generateBufferFromJson } from '../../core/generator';
import { createDocumentGenerator } from '../../plugin/createDocumentGenerator';

type Node = {
  name: string;
  props?: Record<string, unknown>;
  children?: Node[];
  enabled?: boolean;
};

const PNG_1PX =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

const cover = (extra: Record<string, unknown> = {}): Node => ({
  name: 'cover',
  props: {
    title: 'Annual performance review',
    subtitle: 'What changed in 2026 and what to do about it',
    client: 'Acme Holdings',
    date: 'September 2026',
    confidentiality: 'Confidential',
    ...extra,
  },
});

const opener = (number: string, title: string, tracker?: string): Node => ({
  name: 'section-opener',
  props: { number, title, ...(tracker && { tracker }) },
});

const para = (text: string): Node => ({ name: 'paragraph', props: { text } });

/** Cover section, then two content sections under one running head. */
const report = (
  theme: string,
  runningHead: Record<string, unknown> | undefined = {},
  sections: Node[] = [
    {
      name: 'section',
      children: [
        { name: 'running-head', ...(runningHead && { props: runningHead }) },
        opener('01', 'Summary'),
        para('The year in one page.'),
      ],
    },
    {
      name: 'section',
      children: [opener('02', 'Results by region', 'Results'), para('Body.')],
    },
  ]
) => ({
  name: 'docx',
  props: {
    theme,
    metadata: { title: 'Annual review', author: 'A' },
  },
  children: [{ name: 'section', children: [cover()] }, ...sections],
});

const consulting = resolveDocxDesignSystem(consultingTheme);
const MEASURE = 11906 - 2 * 1440;

type Expanded = {
  children: Array<{
    props?: Record<string, unknown> & {
      header?: Node[];
      footer?: Node[];
    };
    children: Array<Node & { children?: Node[] }>;
  }>;
};

describe('cover', () => {
  it('lowers to the consulting cover recipe, in place, with a source map', () => {
    const { document, sourceMap } = expandBlocks(
      report('consulting'),
      consulting
    );
    const block = (document as Expanded).children[0].children[0];
    expect(block.name).toBe('cover');
    expect(block.children!.map((child) => child.name)).toEqual([
      'divider',
      'paragraph',
      'paragraph',
      'paragraph',
      'paragraph',
    ]);
    // The 3pt accent rule a third of the way down the A4 measure: 9.69in of
    // body height, 30% of it, in points.
    expect(block.children![0].props).toEqual({
      thickness: 3,
      color: 'accent',
      spacing: { before: 209, after: 12 },
    });
    expect(block.children![1].props).toEqual({
      text: 'Acme Holdings',
      keepNext: true,
      spacing: { after: 4 },
      themeStyle: 'eyebrow',
    });
    expect(block.children![2].props).toEqual({
      text: 'Annual performance review',
      keepNext: true,
      themeStyle: 'display',
      font: { color: 'primary' },
    });
    expect(block.children![3].props).toEqual({
      text: 'What changed in 2026 and what to do about it',
      keepNext: true,
      themeStyle: 'subtitle',
    });
    expect(block.children![4].props).toEqual({
      text: 'September 2026  ·  Confidential',
      spacing: { before: 12, after: 0 },
      themeStyle: 'label',
    });
    const at = '/children/0/children/0';
    expect(sourceMap).toMatchObject({
      [`${at}/children/0`]: at,
      [`${at}/children/1/props/text`]: `${at}/props/client`,
      [`${at}/children/2/props/text`]: `${at}/props/title`,
      [`${at}/children/3/props/text`]: `${at}/props/subtitle`,
      [`${at}/children/4/props/text`]: `${at}/props/date`,
    });
  });

  it('places the logo where the theme says and holds on a theme with no recipe', () => {
    const doc = {
      ...report('minimal', undefined, []),
      children: [
        {
          name: 'section',
          children: [
            cover({
              logo: { base64: PNG_1PX, alt: 'Acme' },
              subtitle: undefined,
              client: undefined,
              date: undefined,
            }),
          ],
        },
      ],
    };
    const block = (expandBlocks(doc, minimalTheme).document as Expanded)
      .children[0].children[0];
    expect(block.children!.map((child) => child.name)).toEqual([
      'image',
      'divider',
      'paragraph',
      'paragraph',
    ]);
    expect(block.children![0].props).toEqual({
      base64: PNG_1PX,
      alt: 'Acme',
      width: '25%',
      alignment: 'left',
      spacing: { before: 0, after: 0 },
    });
    // With a logo above it the rule drops less — 22% of minimal's body
    // height; minimal has no recipe, so the fallback 3pt accent rule stands in.
    expect(block.children![1].props).toMatchObject({
      thickness: 3,
      color: 'accent',
      spacing: { before: 148, after: 12 },
    });
    // No `display` role on minimal: the title style, and a bold run for the
    // meta line where the label role would have been.
    expect(block.children![2].props).toEqual({
      text: 'Annual performance review',
      keepNext: true,
      themeStyle: 'title',
    });
    expect(block.children![3].props).toEqual({
      text: 'Confidential',
      spacing: { before: 12, after: 0 },
      font: { size: 9, color: 'textSecondary' },
    });
  });

  it('keeps the eyebrow spacing when a recipe draws no rule and the drop rides on it', () => {
    const theme = {
      ...consulting,
      chrome: { ...consulting.chrome, cover: { rule: { weightPt: 0 } } },
    };
    const doc = report('consulting', undefined, []);
    const block = (expandBlocks(doc, theme).document as Expanded).children[0]
      .children[0];
    expect(block.children!.map((child) => child.name)).toEqual([
      'paragraph',
      'paragraph',
      'paragraph',
      'paragraph',
    ]);
    expect(block.children![0].props).toMatchObject({
      text: 'Acme Holdings',
      spacing: { before: 209, after: 4 },
    });
    expect(block.children![1].props).not.toHaveProperty('spacing');
  });

  it('counts the title and subtitle against their budgets', () => {
    const long = Array.from({ length: 31 }, (_, i) => `w${i}`).join(' ');
    const doc = report('minimal', undefined, []);
    (doc.children[0].children[0] as Node).props!.subtitle = long;
    expect(blockSlotBudgets(doc, ['/children/0/children/0'])).toEqual([
      {
        block: 'cover',
        slot: 'title',
        path: '/children/0/children/0/props/title',
        words: 3,
        maxWords: 12,
      },
      {
        block: 'cover',
        slot: 'subtitle',
        path: '/children/0/children/0/props/subtitle',
        words: 31,
        maxWords: 30,
      },
    ]);
  });
});

describe('section-opener', () => {
  it('lowers to an eyebrow and a level-1 heading, never drawing the tracker', () => {
    const { document, sourceMap } = expandBlocks(
      report('consulting'),
      consulting
    );
    const block = (document as Expanded).children[2].children[0];
    expect(block.children).toEqual([
      {
        name: 'paragraph',
        props: {
          text: '02',
          keepNext: true,
          spacing: { after: 2 },
          themeStyle: 'eyebrow',
        },
      },
      { name: 'heading', props: { text: 'Results by region', level: 1 } },
    ]);
    expect(JSON.stringify(block.children)).not.toContain('"Results"');
    const at = '/children/2/children/0';
    expect(sourceMap).toMatchObject({
      [`${at}/children/0/props/text`]: `${at}/props/number`,
      [`${at}/children/1/props/text`]: `${at}/props/title`,
    });
  });

  it('breaks the page before whichever child comes first, and takes an integer number', () => {
    const doc = {
      name: 'docx',
      props: { theme: 'minimal' },
      children: [
        {
          name: 'section',
          children: [
            {
              name: 'section-opener',
              props: { title: 'Plain', pageBreak: true },
            },
            {
              name: 'section-opener',
              props: { number: 3, title: 'Numbered', pageBreak: true },
            },
          ],
        },
      ],
    };
    const { document } = expandBlocks(doc, minimalTheme);
    const [plain, numbered] = (document as Expanded).children[0].children;
    expect(plain.children).toEqual([
      { name: 'heading', props: { text: 'Plain', level: 1, pageBreak: true } },
    ]);
    expect(numbered.children![0].props).toMatchObject({
      text: '3',
      pageBreak: true,
      font: { size: 9, bold: true, color: 'accent', case: 'upper' },
    });
    expect(numbered.children![1].props).toEqual({
      text: 'Numbered',
      level: 1,
    });
  });
});

describe('running-head', () => {
  it('fills its section and every later one, tracker from each opener, and leaves the cover alone', () => {
    const { document, sourceMap, blocks } = expandBlocks(
      report('consulting', {
        confidentiality: 'Confidential',
        date: 'September 2026',
      }),
      consulting
    );
    const [coverSection, first, second] = (document as Expanded).children;
    expect(blocks).toEqual([
      '/children/0/children/0',
      '/children/1/children/0',
      '/children/1/children/1',
      '/children/2/children/0',
    ]);
    expect(coverSection.props).toBeUndefined();
    // Each section in reach starts a page of its own, whatever the theme's
    // section default: a header belongs to the section a page starts in.
    expect(first.props!.pageBreak).toBe(true);
    expect(second.props!.pageBreak).toBe(true);
    // The block itself lowers to nothing in the flow.
    expect(first.children[0]).toEqual({
      name: 'running-head',
      props: { confidentiality: 'Confidential', date: 'September 2026' },
      children: [],
    });
    for (const [section, tracker] of [
      [first, 'Summary'],
      [second, 'Results'],
    ] as const) {
      expect(section.props!.header).toEqual([
        {
          name: 'paragraph',
          props: {
            text: `Annual review\t${tracker}`,
            tabStops: [{ type: 'right', position: MEASURE }],
            spacing: { before: 0, after: 0 },
            themeStyle: 'tracker',
            font: { color: 'textMuted' },
          },
        },
        {
          name: 'divider',
          props: {
            thickness: 0.5,
            color: 'rule',
            spacing: { before: 2, after: 0 },
          },
        },
      ]);
      expect(section.props!.footer).toEqual([
        {
          name: 'divider',
          props: {
            thickness: 0.5,
            color: 'rule',
            spacing: { before: 0, after: 4 },
          },
        },
        {
          name: 'paragraph',
          props: {
            text: 'Confidential\t{PAGE} / {TOTAL_PAGES}\tSeptember 2026',
            tabStops: [
              { type: 'center', position: MEASURE / 2 },
              { type: 'right', position: MEASURE },
            ],
            spacing: { before: 0, after: 0 },
            themeStyle: 'footer',
            font: { color: 'textMuted' },
          },
        },
      ]);
    }
    const rh = '/children/1/children/0';
    expect(sourceMap).toMatchObject({
      '/children/1/props/header': rh,
      '/children/1/props/header/0/props/text':
        '/children/1/children/1/props/title',
      '/children/1/props/footer': rh,
      '/children/1/props/footer/1/props/text': `${rh}/props/confidentiality`,
      '/children/2/props/header': rh,
      '/children/2/props/header/0/props/text':
        '/children/2/children/0/props/tracker',
      '/children/2/props/footer/1/props/text': `${rh}/props/confidentiality`,
    });
    expect(
      toAuthoredPointer(sourceMap, '/children/2/props/header/1/props/thickness')
    ).toBe(`${rh}/props/thickness`);
  });

  it('yields to authored chrome part by part, and to a later running head', () => {
    const doc = report('consulting', {}, [
      {
        name: 'section',
        children: [{ name: 'running-head' }, opener('01', 'One')],
      },
      {
        name: 'section',
        props: { header: [para('Mine')] },
        children: [opener('02', 'Two')],
      },
      {
        name: 'section',
        props: { header: 'linkToPrevious', footer: [], pageBreak: false },
        children: [para('Three')],
      },
      {
        name: 'section',
        children: [
          {
            name: 'running-head',
            props: { pageNumbers: false, tracker: 'Appendix' },
          },
          para('Four'),
        ],
      },
    ]);
    const { document } = expandBlocks(doc, consulting);
    const [, one, two, three, four] = (document as Expanded).children;
    expect((one.props!.header![0].props as { text: string }).text).toBe(
      'Annual review\tOne'
    );
    // Authored header kept; the footer it did not write is filled.
    expect(two.props!.header).toEqual([para('Mine')]);
    expect(two.props!.footer).toHaveLength(2);
    expect(three.props!.header).toBe('linkToPrevious');
    expect(three.props!.footer).toEqual([]);
    // An authored page-break decision stands too.
    expect(three.props!.pageBreak).toBe(false);
    expect(two.props!.pageBreak).toBe(true);
    // The later running head: its own tracker, no page numbers.
    expect((four.props!.header![0].props as { text: string }).text).toBe(
      'Annual review\tAppendix'
    );
    expect(four.props!.footer).toEqual([
      expect.objectContaining({ name: 'divider' }),
    ]);
  });

  it('draws only what it has: no metadata title, no tracker, no footer text', () => {
    const doc = {
      name: 'docx',
      props: { theme: 'minimal' },
      children: [
        {
          name: 'section',
          children: [
            { name: 'running-head', props: { pageNumbers: false } },
            para('x'),
          ],
        },
      ],
    };
    const { document } = expandBlocks(doc, minimalTheme);
    const section = (document as Expanded).children[0];
    // Nothing to say in the header: only the rule, in the fallback hairline.
    expect(section.props!.header).toEqual([
      {
        name: 'divider',
        props: {
          thickness: 0.5,
          color: 'border',
          spacing: { before: 2, after: 0 },
        },
      },
    ]);
    expect(section.props!.footer).toEqual([
      {
        name: 'divider',
        props: {
          thickness: 0.5,
          color: 'border',
          spacing: { before: 0, after: 4 },
        },
      },
    ]);
    const only = expandBlocks(
      {
        ...doc,
        children: [
          {
            name: 'section',
            children: [{ name: 'running-head', props: { tracker: 'Notes' } }],
          },
        ],
      },
      minimalTheme
    ).document as Expanded;
    expect(only.children[0].props!.header![0].props).toEqual({
      text: 'Notes',
      alignment: 'right',
      spacing: { before: 0, after: 0 },
      font: { size: 8, color: 'textMuted', case: 'upper' },
    });
    expect(only.children[0].props!.footer![1].props).toMatchObject({
      text: '{PAGE} / {TOTAL_PAGES}',
      alignment: 'center',
      font: { size: 8, color: 'textMuted' },
    });
  });

  it('sets a lone footer part where the recipe says, and skips an opener with no props', () => {
    const doc = {
      name: 'docx',
      props: { theme: 'consulting', metadata: { title: 'T' } },
      children: [
        {
          name: 'section',
          children: [
            {
              name: 'running-head',
              props: { date: 'May 2026', pageNumbers: false },
            },
            { name: 'section-opener' },
            opener('02', 'Real'),
          ],
        },
      ],
    };
    const footRight = {
      ...consulting,
      chrome: {
        ...consulting.chrome,
        confidentialFooter: {
          ...consulting.chrome!.confidentialFooter,
          alignment: 'right' as const,
        },
      },
    };
    const section = (expandBlocks(doc, footRight).document as Expanded)
      .children[0];
    expect(section.props!.footer![1].props).toMatchObject({
      text: 'May 2026',
      alignment: 'right',
    });
    expect(section.props!.footer![1].props).not.toHaveProperty('tabStops');
    expect((section.props!.header![0].props as { text: string }).text).toBe(
      'T\tReal'
    );
    // A page number alone sits centred, whatever the recipe says of text.
    const centred = (
      expandBlocks(
        {
          ...doc,
          children: [{ name: 'section', children: [{ name: 'running-head' }] }],
        },
        consulting
      ).document as Expanded
    ).children[0];
    expect(centred.props!.footer![1].props).toMatchObject({
      text: '{PAGE} / {TOTAL_PAGES}',
      alignment: 'center',
    });
  });

  it("lays the chrome out on a section's own page setup", () => {
    const doc = {
      name: 'docx',
      props: { theme: 'consulting', metadata: { title: 'T' } },
      children: [
        {
          name: 'section',
          props: {
            page: { size: 'LETTER', margins: { left: 720, right: 720 } },
          },
          children: [
            { name: 'running-head', props: { confidentiality: 'C' } },
            opener('01', 'One'),
          ],
        },
        {
          name: 'section',
          props: { page: { margins: { left: 2160 } } },
          children: [opener('02', 'Two')],
        },
      ],
    };
    const [letter, wideLeft] = (
      expandBlocks(doc, consulting).document as Expanded
    ).children;
    // 8.5in less two half-inch margins.
    expect(letter.props!.header![0].props).toMatchObject({
      tabStops: [{ type: 'right', position: 12240 - 1440 }],
    });
    expect(letter.props!.footer![1].props).toMatchObject({
      tabStops: [
        { type: 'center', position: 5400 },
        { type: 'right', position: 10800 },
      ],
    });
    // A4 with the theme's right margin and the section's own left one.
    expect(wideLeft.props!.header![0].props).toMatchObject({
      tabStops: [{ type: 'right', position: 11906 - 2160 - 1440 }],
    });
  });

  it('ignores a disabled running head and leaves one outside a section untouched', () => {
    const doc = {
      name: 'docx',
      props: { theme: 'minimal' },
      children: [
        {
          name: 'section',
          props: { header: [{ name: 'running-head' }] },
          children: [
            { name: 'running-head', enabled: false },
            {
              name: 'columns',
              props: { columns: 2 },
              children: [{ name: 'running-head' }, para('x')],
            },
          ],
        },
      ],
    };
    const { document, blocks } = expandBlocks(doc, minimalTheme);
    expect(blocks).toEqual([]);
    expect(document).toBe(doc);
  });
});

describe('the blocks in the pipeline', () => {
  it('validates once lowered, reports facts at authored slots, and is warning-clean on the house theme', () => {
    const doc = report('consulting', { confidentiality: 'Confidential' });
    const { document } = expandBlocks(doc, consulting);
    // What every block lowered to, and the chrome the running head wrote,
    // is a valid document in its own right.
    const expanded = document as Expanded;
    const lowered = {
      ...doc,
      children: [
        {
          name: 'section',
          props: {
            header: expanded.children[1].props!.header,
            footer: expanded.children[1].props!.footer,
          },
          children: [
            expanded.children[0].children[0],
            expanded.children[1].children[1],
            expanded.children[2].children[0],
          ].flatMap((block) => block.children ?? []),
        },
      ],
    };
    expect(validateStrict.document(lowered).errors).toEqual([]);

    const prepared = prepareDocxQualityDocument(doc as never);
    for (const fact of prepared.facts) {
      expect(fact.path).not.toMatch(/\/props\/(header|footer)\//);
      expect(fact.path).not.toMatch(
        /\/children\/\d+\/children\/\d+\/children\//
      );
    }
    expect(analyzeDocxQuality(doc).counts).toEqual({
      error: 0,
      warning: 0,
      info: 0,
    });
  });

  it('reports an over-budget tracker at the opener slot it came from', () => {
    const doc = report('consulting');
    (doc.children[2].children![0] as Node).props!.tracker =
      'Results by every region and every channel';
    const budget = analyzeDocxQuality(doc).diagnostics.filter(
      (entry) => entry.code === 'W_QUALITY_SLOT_BUDGET'
    );
    expect(budget).toEqual([
      expect.objectContaining({
        path: '/children/2/children/0/props/tracker',
        evidence: expect.objectContaining({ actual: 7, expected: 6 }),
      }),
    ]);
  });

  it('compiles the chrome into per-section parts with page fields and tab stops', async () => {
    const doc = report('consulting', {
      confidentiality: 'Confidential',
      date: 'September 2026',
    });
    const compiled = await compileDocumentToIr(doc as never, {
      validation: { enabled: false },
    });
    expect(compiled.unsupported).toEqual([]);
    const [coverSection, first, second] = compiled.ir.sections;
    expect(coverSection.headers).toBeUndefined();
    expect(coverSection.footers).toBeUndefined();
    for (const section of [first, second]) {
      expect(section.headers?.default?.children).toHaveLength(2);
      expect(section.footers?.default?.children).toHaveLength(2);
    }
    const header = first.headers!.default!.children[0];
    expect(header.kind).toBe('paragraph');
    if (header.kind !== 'paragraph') throw new Error('unreachable');
    expect(header.styleId).toBe('tracker');
    expect(header.formatting?.tabStops).toEqual([
      { positionTwips: MEASURE, type: 'right' },
    ]);
    expect(header.children.map((run) => run.kind)).toEqual([
      'text',
      'tab',
      'text',
    ]);
    const footer = second.footers!.default!.children[1];
    if (footer.kind !== 'paragraph') throw new Error('unreachable');
    expect(footer.styleId).toBe('footer');
    expect(
      footer.children
        .filter((run) => run.kind === 'field')
        .map((run) => (run.kind === 'field' ? run.instruction : ''))
    ).toEqual(['PAGE', 'NUMPAGES']);
    // Runs state the role's values, so a page field keeps them in LibreOffice.
    const field = footer.children.find((run) => run.kind === 'field');
    expect(
      field && 'formatting' in field ? field.formatting : undefined
    ).toMatchObject({
      sizeHalfPoints: 16,
      color: { hex: '7B8794' },
    });
  });

  it('renders through both pipelines: one header and footer per content section, none on the cover', async () => {
    const doc = report('consulting', {
      confidentiality: 'Confidential',
      date: 'September 2026',
    });
    for (const renderer of ['docxjs', 'office-open'] as const) {
      const input = { ...doc, renderer };
      const core = await generateBufferFromJson(
        structuredClone(input) as never
      );
      const plugin = await createDocumentGenerator({}).generateBuffer(
        structuredClone(input) as never
      );
      const a = await JSZip.loadAsync(core);
      const b = await JSZip.loadAsync(plugin.buffer);
      const body = await a.file('word/document.xml')!.async('string');
      expect(await b.file('word/document.xml')!.async('string')).toBe(body);

      const headers = Object.keys(a.files).filter((name) =>
        /word\/header\d+\.xml/.test(name)
      );
      const footers = Object.keys(a.files).filter((name) =>
        /word\/footer\d+\.xml/.test(name)
      );
      expect(headers).toHaveLength(2);
      expect(footers).toHaveLength(2);
      const headerXml = (
        await Promise.all(headers.map((name) => a.file(name)!.async('string')))
      ).join('\n');
      const footerXml = (
        await Promise.all(footers.map((name) => a.file(name)!.async('string')))
      ).join('\n');
      expect(headerXml).toContain('Annual review');
      expect(headerXml).toContain('Summary');
      expect(headerXml).toContain('Results');
      expect(headerXml).toContain('w:pStyle w:val="tracker"');
      expect(headerXml).toContain(`<w:tab w:val="right" w:pos="${MEASURE}"`);
      expect(footerXml).toContain('Confidential');
      expect(footerXml).toContain('September 2026');
      expect(footerXml).toMatch(/PAGE/);
      expect(footerXml).toMatch(/NUMPAGES/);
      expect(footerXml).toContain(
        `<w:tab w:val="center" w:pos="${MEASURE / 2}"`
      );

      // The cover section references no chrome part; the two content
      // sections each reference their own.
      const sectPrs = [
        ...body.matchAll(/<w:sectPr[\s>][\s\S]*?<\/w:sectPr>/g),
      ].map((match) => match[0]);
      expect(sectPrs).toHaveLength(3);
      expect(sectPrs[0]).not.toContain('headerReference');
      expect(sectPrs[1]).toContain('headerReference');
      expect(sectPrs[2]).toContain('footerReference');
      expect(body).toContain('Annual performance review');
      expect(body).toContain('w:pStyle w:val="display"');
      expect(body).toContain('w:pStyle w:val="Heading1"');
      expect(body).toContain('w:pStyle w:val="eyebrow"');
    }
  });
});
